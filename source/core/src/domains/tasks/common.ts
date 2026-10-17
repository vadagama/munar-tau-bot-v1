import { cancelParentTasks } from "./cancellation.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { requireRequest } from "../requests/access.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import {
  aggregateCommonWorkState,
  type CommonWorkState,
  requiredTasksAccepted,
  type TaskState,
} from "./fsm.ts";
import { dateInput } from "./service.ts";
export interface CommonWorkRow extends Row {
  id: string;
  number: string;
  state: CommonWorkState;
  building_ids: string[];
  is_test: boolean;
  version: number;
  completed_at: string | null;
}
export function managesArea(
  actor: Actor,
  buildings: string[],
  isTest: boolean,
): boolean {
  return can(actor, "task.manage", {
    taskAccess: { buildingIds: buildings, assigneeId: null, isTest },
  }).allow;
}
export async function buildingInput(
  exec: DbExecutor,
  actor: Actor,
  value: unknown,
): Promise<string[]> {
  if (
    !Array.isArray(value) || !value.length || value.length > 100 ||
    value.some((x) => typeof x !== "string") ||
    new Set(value).size !== value.length
  ) invalid("Укажите дома без повторов");
  const ids = value as string[];
  if (!managesArea(actor, ids, actor.person.isTest)) {
    throw new ApiError("FORBIDDEN");
  }
  if (
    (await exec.query("select id from building where id=any($1::uuid[])", [
      ids,
    ])).length !== ids.length
  ) invalid("Дом не найден");
  return ids;
}
export async function requireCommon(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  lock = false,
): Promise<CommonWorkRow> {
  const [row] = await exec.query<CommonWorkRow>(
    `select * from common_work where id=$1${lock ? " for update" : ""}`,
    [id],
  );
  if (!row || !managesArea(actor, row.building_ids, row.is_test)) {
    throw new ApiError("FORBIDDEN");
  }
  return row;
}
/** Порядок для общего контура: общая работа → связанные обращения по id → задания. */
export async function lockCommonParents(
  exec: DbExecutor,
  id: string,
): Promise<CommonWorkRow> {
  const [work] = await exec.query<CommonWorkRow>(
    "select * from common_work where id=$1 for update",
    [id],
  );
  if (!work) throw new ApiError("NOT_FOUND");
  await exec.query(
    "select r.id from request r join common_work_request l on l.request_id=r.id where l.common_work_id=$1 order by r.id for update of r",
    [id],
  );
  return work;
}
async function workLog(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  row: CommonWorkRow,
  from: string | null,
  meta: Row,
) {
  const linked = await exec.query<
    {
      id: string;
      number: string;
      author_person_id: string;
      state: string;
      unfinished: number;
    }
  >(
    `select r.id,r.number,r.author_person_id,r.state,
   (count(t.id) filter(where t.state<>'accepted_admin'))::int as unfinished
   from common_work_request l join request r on r.id=l.request_id left join task t on t.request_id=r.id and t.is_required
   where l.common_work_id=$1 group by r.id order by r.id`,
    [row.id],
  );
  await exec.query(
    "insert into common_work_log(common_work_id,from_state,to_state,actor_person_id,meta) values($1,$2,$3,$4,$5::text::jsonb)",
    [
      row.id,
      from,
      row.state,
      actor.person.id,
      JSON.stringify({
        ...meta,
        local_pending: linked.filter((r) => r.unfinished > 0).map((r) => ({
          request_id: r.id,
          unfinished: r.unfinished,
        })),
        version: row.version,
        real_person_id: actor.emulation?.realPersonId ?? actor.person.id,
      }),
    ],
  );
  await recordAudit(
    deps,
    exec,
    actor,
    "common_work.changed",
    "common_work",
    row.id,
    row.building_ids,
    from ? { state: from } : null,
    { state: row.state, version: row.version },
  );
  if (from !== null && from !== row.state) {
    const stateText = {
      planned: "запланирована",
      in_progress: "выполняется",
      on_review: "на проверке",
      completed: "завершена",
      canceled: "отменена",
    }[row.state];
    for (
      const request of linked.filter((r) => !CLOSED_STATES.includes(r.state))
    ) {
      const next = row.state === "completed"
        ? request.unfinished > 0
          ? "Остаются локальные задания; результат обращения пока не готов."
          : "Администратор подготовит результат для вашего отдельного подтверждения."
        : "Проверка вашего обращения остаётся отдельной.";
      await notifyPerson(
        exec,
        request.author_person_id,
        `Обращение ${request.number}: общая работа ${row.number} ${stateText}. ${next}`,
        `common:${row.id}:${row.version}:${request.id}`,
        {requestId:request.id,audience:"resident",type:row.state==="canceled"?"request.required":"request.status",important:row.state==="canceled",isTest:row.is_test},
      );
    }
  }
}
export async function syncCommonWork(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  id: string,
) {
  const [work] = await exec.query<CommonWorkRow>(
    "select * from common_work where id=$1",
    [id],
  );
  const tasks = await exec.query<
    { state: TaskState; is_required: boolean; started_at: string | null }
  >("select state,is_required,started_at from task where common_work_id=$1", [
    id,
  ]);
  const state = aggregateCommonWorkState(
    work!.state,
    tasks.map((t) => ({
      state: t.state,
      isRequired: t.is_required,
      started: !!t.started_at,
    })),
  );
  const [updated] = await exec.query<CommonWorkRow>(
    "update common_work set state=$2,version=version+1,completed_at=case when $2='completed' then completed_at else null end where id=$1 returning *",
    [id, state],
  );
  if (tasks.some((t) => !!t.started_at)) {
    await exec.query(
      "update request set work_execution_required=true,work_started_at=coalesce(work_started_at,now()),version=version+1 where id in(select request_id from common_work_request where common_work_id=$1) and work_started_at is null",
      [id],
    );
  }
  await workLog(deps, exec, actor, updated!, work!.state, {
    action: "task_changed",
    previous_completed_at: work!.completed_at,
  });
}
async function link(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  work: CommonWorkRow,
  requestId: string,
) {
  const request = await requireRequest(
    exec,
    actor,
    requestId,
    "request.manage",
    true,
  );
  if (
    request.kind !== "request" || CLOSED_STATES.includes(request.state) ||
    request.state === "awaiting_confirmation" || !request.building_id ||
    !work.building_ids.includes(request.building_id)
  ) invalid("Обращение нельзя связать с этой работой");
  if (["completed", "canceled"].includes(work.state)) {
    invalid("Общая работа уже завершена");
  }
  const added = await exec.query(
    "insert into common_work_request(common_work_id,request_id) values($1,$2) on conflict do nothing returning request_id",
    [work.id, requestId],
  );
  if (!added.length) return;
  await exec.query(
    "update request set work_execution_required=true,work_started_at=case when exists(select 1 from task where common_work_id=$2 and started_at is not null) then coalesce(work_started_at,now()) else work_started_at end,version=version+1 where id=$1",
    [requestId, work.id],
  );
  await notifyPerson(
    exec,
    request.author_person_id,
    `Обращение ${request.number} связано с работой ${work.number}. План: ${work.plan}. Срок: ${
      new Date(String(work.due_at)).toISOString()
    }. Проверка результата останется отдельной.`,
    `common:${work.id}:linked:${requestId}:${request.version}`,
    {requestId,audience:"resident",type:"request.status",isTest:work.is_test},
  );
}
export async function createCommonWork(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key: unknown,
): Promise<CommonWorkRow> {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, "common:create", key, input, async () => {
      const buildings = await buildingInput(exec, actor, input.building_ids);
      const ids = input.request_ids ?? [];
      if (
        !Array.isArray(ids) || ids.length > 50 || ids.some((id) =>
          typeof id !== "string"
        ) || new Set(ids).size !== ids.length
      ) invalid("Некорректные обращения");
      const [work] = await exec.query<CommonWorkRow>(
        "insert into common_work(title,plan,due_at,building_ids,is_test,created_by) values($1,$2,$3,$4,$5,$6) returning *",
        [
          content(input.title),
          content(input.plan),
          dateInput(input.due_at),
          buildings,
          actor.person.isTest,
          actor.person.id,
        ],
      );
      for (const id of [...ids].sort()) {
        await link(deps, exec, actor, work!, id);
      }
      await workLog(deps, exec, actor, work!, null, {
        action: "created",
        request_ids: ids,
      });
      return work!;
    }, async (row) => {
      await requireCommon(exec, actor, row.id);
    })
  );
}
export async function listCommonWorks(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<CommonWorkRow>(
    "select * from common_work where is_test=$1 order by created_at desc",
    [actor.person.isTest],
  );
  return rows.filter((r) => managesArea(actor, r.building_ids, r.is_test));
}
export async function getCommonWork(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  const row = await requireCommon(deps.db, actor, id);
  return {
    ...row,
    request_refs: await deps.db.query(
      "select r.id,r.number from request r join common_work_request l on l.request_id=r.id where l.common_work_id=$1",
      [id],
    ),
    tasks: await deps.db.query(
      "select * from task where common_work_id=$1 order by created_at",
      [id],
    ),
    request_ids: (await deps.db.query<{ request_id: string }>(
      "select request_id from common_work_request where common_work_id=$1",
      [id],
    )).map((r) => r.request_id),
    log: await deps.db.query(
      "select * from common_work_log where common_work_id=$1 order by id",
      [id],
    ),
  };
}
export async function linkCommonRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `common:${id}:link`, key, input, async () => {
      await requireCommon(exec, actor, id);
      const work = await lockCommonParents(exec, id);
      checkVersion(work.version, input.version);
      const requestId = content(input.request_id);
      await link(deps, exec, actor, work, requestId);
      const [updated] = await exec.query<CommonWorkRow>(
        "update common_work set version=version+1 where id=$1 returning *",
        [id],
      );
      await workLog(deps, exec, actor, updated!, work.state, {
        action: "linked",
        request_id: requestId,
      });
      return updated!;
    }, async () => {
      await requireCommon(exec, actor, id);
      await requireRequest(
        exec,
        actor,
        content(input.request_id),
        "request.manage",
      );
    })
  );
}
export async function transitionCommonWork(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `common:${id}:transition`, key, input, async () => {
      await requireCommon(exec, actor, id);
      const work = await lockCommonParents(exec, id);
      checkVersion(work.version, input.version);
      if (["completed", "canceled"].includes(work.state)) {
        invalid("Общая работа уже завершена");
      }
      const action = content(input.action), reason = content(input.reason);
      const tasks = await exec.query<
        { state: TaskState; is_required: boolean; started_at: string | null }
      >(
        "select state,is_required,started_at from task where common_work_id=$1",
        [id],
      );
      let state: CommonWorkState;
      if (action === "complete") {
        if (
          !requiredTasksAccepted(
            tasks.map((t) => ({
              state: t.state,
              isRequired: t.is_required,
              started: !!t.started_at,
            })),
          )
        ) invalid("Не все обязательные задания приняты");
        state = "completed";
      } else if (action === "cancel") {
        if (input.stop_checked !== true) {
          invalid("Подтвердите согласованную остановку всех заданий");
        }
        const links = await exec.query<{ request_id: string }>(
          "select request_id from common_work_request where common_work_id=$1",
          [id],
        );
        const decisions = input.request_decisions;
        if (
          !Array.isArray(decisions) || decisions.length !== links.length ||
          new Set(decisions.map((d) => d?.request_id)).size !== links.length ||
          links.some((l) =>
            !decisions.some((d) =>
              d?.request_id === l.request_id && typeof d.reason === "string" &&
              d.reason.trim()
            )
          )
        ) invalid("Укажите решение по каждому связанному обращению");
        await cancelParentTasks(deps, exec, actor, "common_work", id, reason);
        state = "canceled";
      } else invalid("Неизвестное действие общей работы");
      const [updated] = await exec.query<CommonWorkRow>(
        "update common_work set state=$2,version=version+1,completed_at=case when $2='completed' then now() else null end where id=$1 returning *",
        [id, state],
      );
      await workLog(deps, exec, actor, updated!, work.state, {
        action,
        reason,
        request_decisions: input.request_decisions ?? [],
      });
      return updated!;
    }, async () => {
      await requireCommon(exec, actor, id);
    })
  );
}
export async function unlinkCommonRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `common:${id}:unlink`, key, input, async () => {
      await requireCommon(exec, actor, id);
      const work = await lockCommonParents(exec, id);
      checkVersion(work.version, input.version);
      const requestId = content(input.request_id),
        reason = content(input.reason),
        plan = content(input.resolution_plan);
      const request = await requireRequest(
        exec,
        actor,
        requestId,
        "request.manage",
        true,
      );
      if (
        CLOSED_STATES.includes(request.state) ||
        request.state === "awaiting_confirmation"
      ) invalid("Сначала отзовите результат или возобновите обращение");
      const removed = await exec.query(
        "delete from common_work_request where common_work_id=$1 and request_id=$2 returning request_id",
        [id, requestId],
      );
      if (!removed.length) invalid("Обращение не связано с работой");
      await exec.query("update request set version=version+1 where id=$1", [
        requestId,
      ]);
      const [updated] = await exec.query<CommonWorkRow>(
        "update common_work set version=version+1 where id=$1 returning *",
        [id],
      );
      await workLog(deps, exec, actor, updated!, work.state, {
        action: "unlinked",
        request_id: requestId,
        reason,
        resolution_plan: plan,
      });
      await notifyPerson(
        exec,
        request.author_person_id,
        `Обращение ${request.number}: дальнейший план — ${plan}.`,
        `common:${id}:unlink:${requestId}:${request.version}`,
      {requestId,audience:"resident",type:"request.status",isTest:actor.person.isTest},
      );
      return updated!;
    }, async () => {
      await requireCommon(exec, actor, id);
      await requireRequest(
        exec,
        actor,
        content(input.request_id),
        "request.manage",
      );
    })
  );
}
export async function commonAssignees(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  const work = await requireCommon(deps.db, actor, id);
  return deps.db.query(
    `select distinct p.id,p.full_name from person p join staff_assignment a on a.person_id=p.id
 where p.status='active' and p.is_test=$1 and a.role='executor' and a.status='active'
 and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())
 and not exists(select 1 from unnest($2::uuid[]) b(id) where not exists(select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=b.id)) order by p.full_name`,
    [work.is_test, work.building_ids],
  );
}
