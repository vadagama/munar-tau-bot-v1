import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { TASK_SELECT, type TaskRow } from "./access.ts";
import { taskLog } from "./service.ts";
/** Вызывает уже авторизованный переход родителя после согласования остановки.
 * Общая работа и локальные задания имеют разные родители: отмена обращения не затрагивает чужой общий объём.
 */
export async function cancelParentTasks(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  parent: "request" | "common_work",
  id: string,
  reason: string,
) {
  const tasks = await exec.query<TaskRow>(
    `${TASK_SELECT} where t.${parent}_id=$1 and t.state not in ('accepted_admin','canceled') order by t.id for update of t`,
    [id],
  );
  for (const task of tasks) {
    await exec.query(
      "update task set state='canceled',prev_state=null,version=version+1,updated_at=now() where id=$1",
      [task.id],
    );
    await taskLog(
      deps,
      exec,
      actor,
      {
        ...task,
        state: "canceled",
        prev_state: null,
        version: task.version + 1,
      },
      `${parent}_canceled`,
      task.state,
      reason,
      { parent_id: id, was_required: task.is_required },
    );
  }
}
