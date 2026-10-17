import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { requestAccess, requireRequest } from "../requests/access.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import {
  requireTask,
  TASK_SELECT,
  taskResource,
  type TaskRow,
} from "./access.ts";
import { dateInput, taskLog } from "./service.ts";
import { fmtInterval } from "../../bot/text.ts";
async function residentAccess(exec: DbExecutor, actor: Actor, task: TaskRow) {
  if (!task.request_id) throw new ApiError("FORBIDDEN");
  const request = await requireRequest(exec, actor, task.request_id);
  const access = await requestAccess(exec, actor, request);
  const own = request.author_person_id === actor.person.id &&
    access.activeAuthor;
  if (!own && !access.participant) throw new ApiError("FORBIDDEN");
  if (CLOSED_STATES.includes(request.state)) invalid("Обращение завершено");
  return own ? "author" : "participant";
}
export async function listRequestVisits(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  await requireRequest(deps.db, actor, id);
  return deps.db.query(
    `select v.id,v.interval_start,v.interval_end,v.status,v.version,v.confirmed_by_kind
 from visit v join task t on t.id=v.task_id where t.request_id=$1 order by v.created_at desc`,
    [id],
  );
}
export async function proposeVisit(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key: unknown,
): Promise<Row> {
  const taskId = content(input.task_id);
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      `visits:${taskId}:propose`,
      key,
      input,
      async () => {
        const initial = await requireTask(exec, actor, taskId);
        if (
          !can(actor, "task.manage", taskResource(initial)).allow &&
          !can(actor, "task.execute", taskResource(initial)).allow
        ) throw new ApiError("FORBIDDEN");
        if (!initial.request_id) {
          invalid("Визит согласуется по конкретному обращению");
        }
        const [request] = await exec.query(
          "select * from request where id=$1 for update",
          [initial.request_id],
        );
        const task = await requireTask(exec, actor, taskId, "task.read", true);
        if (
          !request || !request.premises_id ||
          CLOSED_STATES.includes(String(request.state)) ||
          ["canceled", "accepted_admin"].includes(task.state)
        ) invalid("Визит недоступен");
        const start = dateInput(input.interval_start),
          end = dateInput(input.interval_end);
        if (
          Date.parse(end) <= Date.parse(start) ||
          Date.parse(start) <= Date.now()
        ) invalid("Укажите будущий интервал визита");
        await exec.query(
          "update visit set status='rescheduled',version=version+1 where task_id=$1 and status in ('proposed','confirmed')",
          [taskId],
        );
        const [visit] = await exec.query(
          `insert into visit(task_id,interval_start,interval_end,note,created_by) values ($1,$2,$3,$4,$5) returning *`,
          [
            taskId,
            start,
            end,
            content(input.note, "описание визита"),
            actor.person.id,
          ],
        );
        await exec.query("update task set version=version+1 where id=$1", [
          taskId,
        ]);
        await taskLog(
          deps,
          exec,
          actor,
          { ...task, version: task.version + 1 },
          "visit_proposed",
          task.state,
          null,
          { visit_id: visit!.id, interval_start: start, interval_end: end },
        );
        await notifyPerson(
          exec,
          String(request.author_person_id),
          {
            ru: `Предложен визит: ${fmtInterval(start, end)}. Подтвердите интервал в карточке обращения.`,
            kk: `Сапар ұсынылды: ${fmtInterval(start, end)}. Аралықты өтініш картасында растаңыз.`,
          },
          `visit:${visit!.id}:proposed`,
          {requestId:String(task.request_id),audience:"resident",type:"request.required",important:true,isTest:task.is_test},
        );
        return visit!;
      },
      async () => {
        await requireTask(exec, actor, taskId);
      },
    )
  );
}
export async function updateVisit(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
): Promise<Row> {
  const action = content(input.action);
  const authorize = async (exec: DbExecutor, task: TaskRow) => {
    if (["confirm", "no_show"].includes(action)) {
      return residentAccess(exec, actor, task);
    }
    const permission = action === "no_access" ? "task.execute" : "task.manage";
    if (!can(actor, permission, taskResource(task)).allow) {
      throw new ApiError("FORBIDDEN");
    }
    return null;
  };
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `visits:${id}`, key, input, async () => {
      const [v] = await exec.query("select * from visit where id=$1", [id]);
      if (!v) throw new ApiError("NOT_FOUND");
      const [initial] = await exec.query<TaskRow>(
        `${TASK_SELECT} where t.id=$1`,
        [v.task_id],
      );
      if (!initial) throw new ApiError("NOT_FOUND");
      await authorize(exec, initial);
      if (!initial.request_id) invalid("Нужно конкретное обращение");
      const [parent] = await exec.query(
        "select state from request where id=$1 for update",
        [initial.request_id],
      );
      const [task] = await exec.query<TaskRow>(
        `${TASK_SELECT} where t.id=$1 for update of t`,
        [v.task_id],
      );
      const kind = await authorize(exec, task!);
      const [visit] = await exec.query(
        "select * from visit where id=$1 for update",
        [id],
      );
      checkVersion(Number(visit!.version), input.version);
      if (
        !parent || CLOSED_STATES.includes(String(parent.state)) ||
        ["canceled", "accepted_admin"].includes(task!.state)
      ) invalid("Визит недоступен");
      const meta: Row = { visit_id: id, action };
      let reason: string | null = null;
      if (action === "confirm") {
        if (
          visit!.status !== "proposed" ||
          new Date(String(visit!.interval_end)).getTime() <= Date.now()
        ) invalid("Предложение визита устарело");
        await exec.query(
          "update visit set status='confirmed',confirmed_by_person=$2,confirmed_by_kind=$3,version=version+1 where id=$1",
          [id, actor.person.id, kind],
        );
      } else if (action === "no_access" || action === "no_show") {
        if (visit!.status !== "confirmed") invalid("Нужен согласованный визит");
        if (new Date(String(visit!.interval_start)).getTime() > Date.now()) {
          invalid("Интервал визита ещё не наступил");
        }
        reason = content(input.reason);
        if (action === "no_access") {
          if (
            !["accepted", "in_progress", "suspended", "rework"].includes(
              task!.state,
            )
          ) invalid("Задание должно быть принято исполнителем");
          meta.contact_attempts = content(
            input.contact_attempts,
            "попытки связаться",
          );
          meta.occurred_at = dateInput(input.occurred_at);
          if (Date.parse(String(meta.occurred_at)) > Date.now()) {
            invalid("Время события не может быть в будущем");
          }
        }
        // Сообщение о неявке — заявление жителя, а не установленное нарушение.
        meta.confirmed_violation = false;
        await exec.query("update visit set version=version+1 where id=$1", [
          id,
        ]);
        const [r] = await exec.query(
          "select author_person_id from request where id=$1",
          [task!.request_id],
        );
        if (action === "no_access") {
          await notifyPerson(
            exec,
            String(r!.author_person_id),
            {
              ru: "Исполнитель сообщил об отсутствии доступа. Согласуйте новый визит.",
              kk: "Орындаушы қолжетімділік жоқ екенін хабарлады. Жаңа сапарды келістіріңіз.",
            },
            `visit:${id}:${Number(visit!.version) + 1}:no_access`,
            {requestId:String(task!.request_id),audience:"resident",type:"request.required",important:true,isTest:task!.is_test},
          );
        }
      } else if (action === "review_no_show") {
        reason = content(input.reason, "результат проверки");
        meta.confirmed_violation = input.confirmed_violation === true;
        if (
          !(await exec.query(
            "select id from task_log where task_id=$1 and meta->>'visit_id'=$2 and meta->>'action'='no_show'",
            [task!.id, id],
          )).length
        ) invalid("Нет сообщения о неявке для проверки");
        await exec.query("update visit set version=version+1 where id=$1", [
          id,
        ]);
      } else invalid("Неизвестное действие визита");
      await exec.query("update task set version=version+1 where id=$1", [
        task!.id,
      ]);
      await taskLog(
        deps,
        exec,
        actor,
        { ...task!, version: task!.version + 1 },
        `visit_${action}`,
        task!.state,
        reason,
        meta,
      );
      return (await exec.query("select * from visit where id=$1", [id]))[0]!;
    }, async () => {
      const [task] = await exec.query<TaskRow>(
        `${TASK_SELECT} join visit v on v.task_id=t.id where v.id=$1`,
        [id],
      );
      if (!task) throw new ApiError("NOT_FOUND");
      await authorize(exec, task);
    })
  );
}
