import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
import { requireRequest } from "../requests/access.ts";
import { requireTask, taskResource } from "../tasks/access.ts";
import type { DocumentRow } from "./types.ts";
export type DocumentAction = "document.read" | "document.prepare" | "document.review" | "document.manage";

export async function documentResource(exec: DbExecutor, actor: Actor, row: DocumentRow): Promise<ResourceRef> {
  const scope = await exec.query<{ building_id: string }>("select building_id from document_scope where document_id=$1 order by building_id", [row.id]);
  let sourceAllowed = true, sourceManageable = true, assignedTask = false;
  const authors: string[] = [];
  try {
    if (row.task_id) {
      const task = await requireTask(exec, actor, row.task_id);
      sourceManageable = can(actor, "task.manage", taskResource(task)).allow;
      assignedTask = task.assignee_person_id === actor.person.id;
      if (task.assignee_person_id) authors.push(task.assignee_person_id);
      const reports = await exec.query<{ author_person_id: string }>("select distinct created_by as author_person_id from task_report where task_id=$1", [row.task_id]);
      authors.push(...reports.map(r => r.author_person_id));
    } else if (row.request_id) {
      await requireRequest(exec, actor, row.request_id);
      try { await requireRequest(exec, actor, row.request_id, "request.manage"); }
      catch (error) { if (!(error instanceof ApiError) || error.code !== "FORBIDDEN") throw error; sourceManageable = false; }
    }
  } catch (error) {
    if (!(error instanceof ApiError) || !["NOT_FOUND", "FORBIDDEN"].includes(error.code)) throw error;
    sourceAllowed = false; sourceManageable = false;
  }
  const ids = scope.map(s => s.building_id);
  const [membership] = await exec.query<{ member: boolean; owner: boolean }>(
    `select exists(select 1 from connection c join premises p on p.id=c.premises_id
      where c.person_id=$1 and c.status='active' and p.is_test=$2
      and (c.start_date is null or c.start_date<=(now() at time zone 'Asia/Almaty')::date)
      and (c.end_date is null or c.end_date>=(now() at time zone 'Asia/Almaty')::date)
      and p.building_id=any($3::uuid[])) as member,
      exists(select 1 from connection c join premises p on p.id=c.premises_id
      where c.person_id=$1 and c.status='active' and c.role='owner' and p.is_test=$2
      and (c.start_date is null or c.start_date<=(now() at time zone 'Asia/Almaty')::date)
      and (c.end_date is null or c.end_date>=(now() at time zone 'Asia/Almaty')::date)
      and (cardinality($3::uuid[])=0 or p.building_id=any($3::uuid[]))) as owner`,
    [actor.person.id, actor.person.isTest, ids],
  );
  return { documentAccess: {
    buildingIds: ids, isTest: row.is_test, audience: row.audience,
    published: row.published_version_id !== null, member: ids.length === 0 || !!membership?.member,
    owner: !!membership?.owner, sourceAllowed, sourceManageable,
    preparedById: row.prepared_by, reviewerId: row.reviewer_id, assignedTask, resultAuthorIds: authors,
  } };
}
export async function requireDocument(exec: DbExecutor, actor: Actor, id: string, action: DocumentAction = "document.read", lock = false) {
  const [row] = await exec.query<DocumentRow>(`select * from document where id=$1${lock ? " for update" : ""}`, [id]);
  if (!row || !can(actor, action, await documentResource(exec, actor, row)).allow) throw new ApiError(action === "document.read" ? "NOT_FOUND" : "FORBIDDEN");
  return row;
}
