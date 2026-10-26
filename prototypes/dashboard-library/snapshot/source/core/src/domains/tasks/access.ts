import type { DbExecutor } from "../../db/client.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { Row } from "../registry/validation.ts";
import type { TaskState } from "./fsm.ts";
export interface TaskRow extends Row {
  id: string; request_id: string | null; common_work_id: string | null;
  building_ids: string[]; assignee_person_id: string | null;
  assignee_name?: string | null;
  linked_request?: { id: string; number: string } | null;
  state: TaskState; prev_state: TaskState | null; is_test: boolean; version: number;
  created_by: string; number: string; started_at: string | null;
  depends_on_task_id: string | null; access_required: boolean; is_required: boolean;
}
export function taskResource(row: TaskRow): ResourceRef {
  return { taskAccess: { buildingIds: row.building_ids, assigneeId: row.assignee_person_id, isTest: row.is_test } };
}
export const TASK_SELECT = `select t.*,a.full_name as assignee_name,case when t.request_id is not null then
 array_remove(array[r.building_id],null) else w.building_ids end as building_ids
 from task t left join person a on a.id=t.assignee_person_id left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id`;
export async function requireTask(exec: DbExecutor, actor: Actor, id: string,
  action: "task.read" | "task.manage" | "task.execute" = "task.read", lock = false): Promise<TaskRow> {
  const [row] = await exec.query<TaskRow>(`${TASK_SELECT} where t.id=$1${lock ? " for update of t" : ""}`, [id]);
  if (!row || !can(actor, action, taskResource(row)).allow) throw new ApiError(action === "task.read" ? "NOT_FOUND" : "FORBIDDEN");
  return row;
}

/** ROL-02d: совмещение ролей не разрешает приёмку собственного результата. */
export function canAcceptTaskReport(actor:Actor,row:TaskRow,reportAuthorId:unknown):boolean {
 return row.state === "on_review" && typeof reportAuthorId === "string" &&
  reportAuthorId !== actor.person.id && row.assignee_person_id !== actor.person.id &&
  can(actor,"task.manage",taskResource(row)).allow;
}
