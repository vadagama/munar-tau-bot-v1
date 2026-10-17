import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { requireTask, type TaskRow } from "./access.ts";
import { taskLog } from "./service.ts";
/** JOB-04: заявление исполнителя не создаёт назначение без решения администратора. */
export async function reportProblem(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `task:${id}:problem`, key, input, async () => {
      const task = await requireTask(exec, actor, id, "task.execute", true);
      if (
        !["accepted", "in_progress", "on_review", "rework", "accepted_admin"]
          .includes(task.state)
      ) invalid("Сначала примите задание");
      const place = content(input.location),
        description = content(input.description),
        ids = input.attachment_ids;
      if (
        !Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some((x) =>
          typeof x !== "string"
        ) || new Set(ids).size !== ids.length
      ) invalid("Приложите фотографии найденной проблемы");
      const files = await exec.query(
        "select id from attachment where task_id=$1 and id=any($2::uuid[]) and uploaded_by=$3 and status='complete' and mime like 'image/%' for share",
        [id, ids, actor.person.id],
      );
      if (files.length !== ids.length) {
        invalid("Нужны сохранённые фотографии этого задания");
      }
      await exec.query("update task set version=version+1 where id=$1", [id]);
      await taskLog(
        deps,
        exec,
        actor,
        { ...task, version: task.version + 1 },
        "found_problem",
        task.state,
        null,
        { location: place, description, attachment_ids: ids },
      );
      const [log] = await exec.query(
        "select id from task_log where task_id=$1 order by id desc limit 1",
        [id],
      );
      return { problem_id: log!.id };
    }, async () => {
      await requireTask(exec, actor, id, "task.execute");
    })
  );
}
export async function linkProblem(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `problem:${id}:link`, key, input, async () => {
      const [problem] = await exec.query<Row>(
        "select * from task_log where id=$1 and meta->>'action'='found_problem'",
        [id],
      );
      if (!problem) invalid("Сообщение о проблеме не найдено");
      const source = await requireTask(
        exec,
        actor,
        String(problem.task_id),
        "task.manage",
        true,
      );
      const target = await requireTask(
        exec,
        actor,
        content(input.task_id),
        "task.manage",
      );
      if (source.id === target.id || target.state === "canceled") {
        invalid("Выберите отдельное действующее задание");
      }
      if (
        (await exec.query(
          "select id from task_log where task_id=$1 and meta->>'problem_id'=$2 and meta->>'action'='problem_linked'",
          [source.id, id],
        )).length
      ) invalid("По проблеме уже определено задание");
      await exec.query("update task set version=version+1 where id=$1", [
        source.id,
      ]);
      await taskLog(
        deps,
        exec,
        actor,
        { ...source, version: source.version + 1 } as TaskRow,
        "problem_linked",
        source.state,
        content(input.reason),
        {
          problem_id: id,
          linked_task_id: target.id,
          linked_task_number: target.number,
        },
      );
      return { problem_id: id, task_id: target.id };
    }, async () => {
      const [problem] = await exec.query<Row>(
        "select task_id,meta from task_log where id=$1",
        [id],
      );
      if (!problem || jsonValue<Row>(problem.meta).action !== "found_problem") {
        invalid("Сообщение не найдено");
      }
      await requireTask(exec, actor, String(problem.task_id), "task.manage");
      await requireTask(exec, actor, content(input.task_id), "task.manage");
    })
  );
}
