import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
import { requestAccess, requestLinkColumns, type RequestLinks, type RequestRow } from "../requests/access.ts";
import { TASK_SELECT, type TaskRow, taskResource } from "../tasks/access.ts";
import type { DocumentRow } from "./types.ts";
import { financialDocumentGrants } from "./financial-grants.ts";
export type DocumentAction = "document.read" | "document.prepare" | "document.review" | "document.manage";
export function internalDocumentReader(actor: Actor, resource: ResourceRef) {
  if ((["document.prepare", "document.review", "document.manage"] as const).some(action => can(actor, action, resource).allow)) return true;
  const r = resource.documentAccess;
  return !!r && (r.financial || r.audience === "finance") && can(actor, "document.read", {
    documentAccess: { ...r, published: false, member: false, owner: false },
  }).allow;
}
export function documentVersionReadable(actor: Actor, resource: ResourceRef, version: { id: string; state: string; was_published: boolean }) {
  const r = resource.documentAccess;
  return internalDocumentReader(actor, resource) || version.was_published || !!r?.financialVersionIds?.includes(version.id) ||
    (!!r?.assignedTask && !r.financial && version.state === "approved");
}
interface AccessData {
  scopes: Map<string, string[]>; tasks: Map<string, TaskRow>;
  reports: Map<string, string[]>; requests: Map<string, RequestRow & RequestLinks>;
  membership: { building_id: string; owner: boolean }[];
  financialGrants: Map<string, string[]>;
}

export async function documentResource(exec: DbExecutor, actor: Actor, row: DocumentRow, scopeOverride?: string[], data?: AccessData): Promise<ResourceRef> {
  const scopeIds = scopeOverride ?? data?.scopes.get(row.id);
  const scope = scopeIds ? scopeIds.map(building_id => ({ building_id })) : await exec.query<{ building_id: string }>("select building_id from document_scope where document_id=$1 order by building_id", [row.id]);
  let sourceAllowed = true, sourceManageable = true, assignedTask = false;
  let reviewSource: NonNullable<ResourceRef["documentAccess"]>["reviewSource"];
  const authors: string[] = [];
  if (row.task_id) {
      const task = data ? data.tasks.get(row.task_id) : (await exec.query<TaskRow>(`${TASK_SELECT} where t.id=$1`, [row.task_id]))[0];
      sourceAllowed = !!task && can(actor, "task.read", taskResource(task)).allow;
      sourceManageable = false;
      if (task) {
      sourceManageable = can(actor, "task.manage", taskResource(task)).allow;
      assignedTask = task.assignee_person_id === actor.person.id;
      reviewSource = { isTest: task.is_test, draft: false, chairmanOnly: false, complaintSubjectId: null };
      if (task.assignee_person_id) authors.push(task.assignee_person_id);
      const reports = data ? (data.reports.get(row.task_id) ?? []).map(author_person_id => ({ author_person_id })) : await exec.query<{ author_person_id: string }>("select distinct created_by as author_person_id from task_report where task_id=$1", [row.task_id]);
      authors.push(...reports.map(r => r.author_person_id));
      if (task.request_id) {
        const source = data ? data.requests.get(task.request_id) : (await exec.query<RequestRow>("select * from request where id=$1", [task.request_id]))[0];
        if (!source) { sourceAllowed = false; reviewSource = undefined; }
        else {
          reviewSource = { isTest: source.is_test, draft: source.state === "draft", chairmanOnly: source.complaint_route === "chairman", complaintSubjectId: source.complaint_subject_person_id };
          const requestResource = { requestAccess: await requestAccess(exec, actor, source, data?.requests.get(source.id)) };
          const mayReadSource = can(actor, ["staff", "finance", "service"].includes(row.audience) ? "request.internal" : "request.read", requestResource).allow;
          sourceAllowed = sourceAllowed && (assignedTask || mayReadSource);
          sourceManageable = sourceManageable && can(actor, "request.manage", requestResource).allow;
          const shared = !!row.published_version_id && ["resident", "owner"].includes(row.audience) &&
            mayReadSource;
          sourceAllowed = (sourceAllowed || shared) && task.is_test === actor.person.isTest && source.is_test === actor.person.isTest;
        }
      }
      }
  } else if (row.request_id) {
      const source = data ? data.requests.get(row.request_id) : (await exec.query<RequestRow>("select * from request where id=$1", [row.request_id]))[0];
      sourceAllowed = false; sourceManageable = false;
      if (source) {
        const access = { requestAccess: await requestAccess(exec, actor, source, data?.requests.get(source.id)) };
        sourceAllowed = can(actor, ["staff", "finance", "service"].includes(row.audience) ? "request.internal" : "request.read", access).allow;
        sourceManageable = can(actor, "request.manage", access).allow;
        reviewSource = { isTest: source.is_test, draft: source.state === "draft", chairmanOnly: source.complaint_route === "chairman", complaintSubjectId: source.complaint_subject_person_id };
      }
  }
  const ids = scope.map(s => s.building_id);
  const membership = data ? {
    member: data.membership.some(m => ids.includes(m.building_id)),
    owner: data.membership.some(m => m.owner && (!ids.length || ids.includes(m.building_id))),
  } : (await exec.query<{ member: boolean; owner: boolean }>(
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
  ))[0];
  const financialVersionIds = (data?.financialGrants ?? await financialDocumentGrants(exec, actor, [row.id])).get(row.id) ?? [];
  return { documentAccess: {
    buildingIds: ids, isTest: row.is_test, audience: row.audience, financial: ["financial_report", "invoice", "receipt"].includes(row.kind),
    published: row.published_version_id !== null || financialVersionIds.length > 0, financialVersionIds, member: ids.length === 0 || !!membership?.member,
    owner: !!membership?.owner, sourceAllowed, sourceManageable,
    preparedById: row.prepared_by, reviewerId: row.reviewer_id, assignedTask, resultAuthorIds: authors, reviewSource,
  } };
}

/** Данные доступа загружаются пакетно, решения остаются у того же PDP. */
export async function documentResources(exec: DbExecutor, actor: Actor, rows: DocumentRow[]): Promise<ResourceRef[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id), taskIds = [...new Set(rows.flatMap(r => r.task_id ? [r.task_id] : []))];
  const scopes = await exec.query<{ document_id: string; building_id: string }>("select document_id,building_id from document_scope where document_id=any($1::uuid[])", [ids]);
  const tasks = taskIds.length ? await exec.query<TaskRow>(`${TASK_SELECT} where t.id=any($1::uuid[])`, [taskIds]) : [];
  const reports = taskIds.length ? await exec.query<{ task_id: string; created_by: string }>("select distinct task_id,created_by from task_report where task_id=any($1::uuid[])", [taskIds]) : [];
  const requestIds = [...new Set([...rows, ...tasks].flatMap(r => r.request_id ? [r.request_id] : []))];
  const requests = requestIds.length ? await exec.query<RequestRow & RequestLinks>(
    `select r.*,${requestLinkColumns("r.id", "$2", "r.premises_id", "r.author_person_id")} from request r where r.id=any($1::uuid[])`, [requestIds, actor.person.id]) : [];
  const membership = await exec.query<{ building_id: string; owner: boolean }>(
    `select distinct p.building_id,c.role='owner' as owner from connection c join premises p on p.id=c.premises_id
     where c.person_id=$1 and c.status='active' and p.is_test=$2
     and (c.start_date is null or c.start_date<=(now() at time zone 'Asia/Almaty')::date)
     and (c.end_date is null or c.end_date>=(now() at time zone 'Asia/Almaty')::date)`, [actor.person.id, actor.person.isTest]);
  const data: AccessData = { scopes: new Map(ids.map(id => [id, []])), tasks: new Map(tasks.map(t => [t.id, t])),
    reports: new Map(), requests: new Map(requests.map(r => [r.id, r])), membership,
    financialGrants: await financialDocumentGrants(exec, actor, ids) };
  for (const s of scopes) data.scopes.get(s.document_id)!.push(s.building_id);
  for (const r of reports) data.reports.set(r.task_id, [...(data.reports.get(r.task_id) ?? []), r.created_by]);
  return Promise.all(rows.map(row => documentResource(exec, actor, row, undefined, data)));
}
export async function requireDocument(exec: DbExecutor, actor: Actor, id: string, action: DocumentAction = "document.read", lock = false) {
  const [row] = await exec.query<DocumentRow>(`select * from document where id=$1${lock ? " for update" : ""}`, [id]);
  if (!row || !can(actor, action, await documentResource(exec, actor, row)).allow) throw new ApiError(action === "document.read" ? "NOT_FOUND" : "FORBIDDEN");
  return row;
}
