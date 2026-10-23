import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { requireRequest } from "../requests/access.ts";
import { requireTask, TASK_SELECT } from "../tasks/access.ts";
import { checkVersion } from "../requests/fsm.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { ruleDeadline } from "../registry/time.ts";
import { requireDocument, documentResource } from "./access.ts";
import { DOCUMENT_KINDS, type DocumentRow } from "./types.ts";
import { actorForPerson } from "./service.ts";
import { checkedDocumentSnapshot, type ObligationResult } from "./snapshot.ts";

export interface Obligation extends Row {
  id: string; request_id: string | null; task_id: string | null;
  prepared_by: string; reviewer_id: string; kind: string; phase: string;
  due_at: string; is_test: boolean; version: number;
  document_version_id: string | null;
}
export function obligationInput(input: Row) {
  const task = input.task_id == null ? null : content(input.task_id);
  const request = input.request_id == null ? null : content(input.request_id);
  const kind = DOCUMENT_KINDS.find(v => v === input.kind);
  if (!!task === !!request || !kind || !["before_acceptance", "after_acceptance"].includes(String(input.phase))) invalid("Укажите объект, тип и этап документального обязательства");
  const prepared = content(input.prepared_by), reviewer = content(input.reviewer_id);
  if (prepared === reviewer || (input.signed_required !== undefined && typeof input.signed_required !== "boolean")) invalid("Проверяющий отличается от подготовителя; признак подписи должен быть логическим");
  return { task_id: task, request_id: request, kind, phase: String(input.phase), basis: content(input.basis, "основание обязательности"), prepared_by: prepared, reviewer_id: reviewer, signed_required: input.signed_required === true };
}
async function parent(exec: DbExecutor, actor: Actor, input: { task_id: string | null; request_id: string | null }, manage = false, lock = false) {
  if (!input.task_id) return requireRequest(exec, actor, input.request_id!, manage ? "request.manage" : "request.read", lock);
  const task = await requireTask(exec, actor, input.task_id, manage ? "task.manage" : "task.read", lock);
  if (manage && task.request_id) await requireRequest(exec, actor, task.request_id, "request.manage");
  return task;
}
async function people(exec: DbExecutor, actor: Actor, prepared: string, reviewer: string) {
  const rows = await exec.query<{ id: string; roles: string[] }>(
    `select p.id,array_agg(a.role::text) as roles from person p join staff_assignment a on a.person_id=p.id
     where p.id=any($1::uuid[]) and p.is_test=$2 and p.status='active' and a.status='active'
     and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) group by p.id`,
    [[prepared, reviewer], actor.person.isTest]);
  if (!rows.find(p => p.id === prepared)?.roles.some(r => r !== "tech_admin") || !rows.find(p => p.id === reviewer)?.roles.some(r => ["chairman", "administrator", "deputy", "doc_reviewer"].includes(r))) invalid("Выберите действующего подготовителя и проверяющего документов");
}
function obligationDocument(row: Pick<Obligation, "id" | "kind" | "prepared_by" | "reviewer_id" | "request_id" | "task_id" | "is_test">): DocumentRow {
  return { id: row.id, title: row.kind, kind: row.kind as DocumentRow["kind"],
    audience: ["invoice", "receipt"].includes(row.kind) ? "finance" : "staff", prepared_by: row.prepared_by, reviewer_id: row.reviewer_id,
    request_id: row.request_id, task_id: row.task_id, is_test: row.is_test, version: 1,
    document_number: null, document_date: "", parties: "", published_version_id: null };
}
function scopeOf(source: Row): string[] {
  return Array.isArray(source.building_ids) ? source.building_ids as string[] : typeof source.building_id === "string" ? [source.building_id] : [];
}
async function checkPeopleForObject(exec: DbExecutor, actor: Actor, row: Parameters<typeof obligationDocument>[0], source: Row) {
  await people(exec, actor, row.prepared_by, row.reviewer_id);
  for (const [id, action] of [[row.prepared_by, "document.prepare"], [row.reviewer_id, "document.review"]] as const) {
    const candidate = await actorForPerson(exec, id, row.is_test);
    if (!can(candidate, action, await documentResource(exec, candidate, obligationDocument(row), scopeOf(source))).allow) invalid("Сотрудник не имеет полномочий на документ этого объекта");
  }
}
export async function createObligation(deps: RegistryDeps, actor: Actor, input: Row, key: unknown) {
  const data = obligationInput(input), reason = content(input.reason, "причину");
  return deps.db.transaction(exec => idempotent(exec, actor, "document.obligation.create", key, input, async () => {
    const source = await parent(exec, actor, data, true, true);
    checkVersion(source.version, input.expected_version);
    await checkPeopleForObject(exec, actor, { ...data, id: crypto.randomUUID(), is_test: actor.person.isTest }, source);
    const deadline = await ruleDeadline(exec, data.phase === "before_acceptance" ? "document_prepare" : "document_after_acceptance", new Date());
    const [rule] = await exec.query<{ params: unknown }>("select params from time_rule_version where id=$1", [deadline.id]);
    const [row] = await exec.query<Obligation>(`insert into document_obligation(task_id,request_id,kind,phase,basis,prepared_by,reviewer_id,signed_required,rule_version_id,rule_snapshot,due_at,created_by,is_test)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb,$11,$12,$13) returning *`,
      [data.task_id, data.request_id, data.kind, data.phase, data.basis, data.prepared_by, data.reviewer_id, data.signed_required, deadline.id, JSON.stringify({ ...data, params: rule!.params, template: source.template_id ? { id: source.template_id, version: source.template_version } : null }), deadline.due.toISOString(), actor.person.id, actor.person.isTest]);
    await exec.query(data.task_id ? "update task set version=version+1 where id=$1" : "update request set version=version+1 where id=$1", [source.id]);
    await recordAudit(deps, exec, actor, "document.obligation.create", "document_obligation", row!.id, [], null, { kind: data.kind, phase: data.phase, rule_version_id: deadline.id }, reason);
    return row!;
  }, () => parent(exec, actor, data, true)));
}
export async function listObligations(deps: RegistryDeps, actor: Actor, source: { requestId?: string; taskId?: string } = {}) {
  if (!can(actor, "document.obligations").allow) throw new ApiError("FORBIDDEN");
  const rows = await deps.db.query<Obligation>(`select o.*,p.full_name as prepared_name,r.full_name as reviewer_name from document_obligation o
    join person p on p.id=o.prepared_by join person r on r.id=o.reviewer_id
    where o.is_test=$1 and ($2::uuid is null or o.request_id=$2 or o.task_id in (
      select t.id from task t left join common_work_request l on l.common_work_id=t.common_work_id where t.request_id=$2 or l.request_id=$2))
    and ($3::uuid is null or o.task_id=$3)
    order by o.completed_at nulls first,o.due_at,o.id`, [actor.person.isTest, source.requestId ?? null, source.taskId ?? null]);
  const items: Row[] = [];
  for (const row of rows) {
    const [source] = await deps.db.query<Row>(row.task_id ? `${TASK_SELECT} where t.id=$1` : "select * from request where id=$1", [row.task_id ?? row.request_id]);
    if (!source) continue;
    const resource = await documentResource(deps.db, actor, obligationDocument(row), scopeOf(source));
    if (!can(actor, "document.read", resource).allow) continue;
    const manage = can(actor, "document.manage", resource).allow;
    items.push({ ...row, source_number: source.number, ...(manage ? { source_version: source.version } : {}), can_manage: manage });
  }
  return { items };
}
export async function fulfillObligation(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  const reason = content(input.reason, "причину");
  return deps.db.transaction(exec => idempotent(exec, actor, `document.obligation.fulfill:${id}`, key, input, async () => {
    const [initial] = await exec.query<Obligation>("select * from document_obligation where id=$1 and is_test=$2", [id, actor.person.isTest]);
    if (!initial) throw new ApiError("NOT_FOUND");
    await parent(exec, actor, initial, true, true);
    const versionId = content(input.document_version_id);
    const [v] = await exec.query<{ document_id: string }>("select document_id from document_version where id=$1", [versionId]);
    if (!v) throw new ApiError("NOT_FOUND");
    await requireDocument(exec, actor, v.document_id, "document.manage", true);
    const [row] = await exec.query<ObligationResult & Obligation>(`select o.*,v.document_id,v.state,v.signed_attachment_id,v.task_report_id,d.is_test as document_is_test,
      d.kind as document_kind,d.task_id as document_task_id,d.request_id as document_request_id,
      d.prepared_by as document_prepared_by,d.reviewer_id as document_reviewer_id,
      (select r.id from task_report r where r.task_id=o.task_id order by r.version desc limit 1) as expected_report_id
      from document_obligation o join document_version v on v.id=$2 join document d on d.id=v.document_id where o.id=$1 for update of o`, [id, versionId]);
    checkVersion(row!.version, input.expected_version);
    checkedDocumentSnapshot([{ ...row!, document_version_id: versionId }], []);
    const [updated] = await exec.query<Obligation>("update document_obligation set document_version_id=$2,completed_at=now(),version=version+1 where id=$1 returning *", [id, versionId]);
    await recordAudit(deps, exec, actor, "document.obligation.fulfill", "document_obligation", id, [], { version: row!.version }, { version: updated!.version, document_version_id: versionId }, reason);
    return updated!;
  }, async () => { const [o] = await exec.query<Obligation>("select * from document_obligation where id=$1", [id]); if (!o) throw new ApiError("NOT_FOUND"); await parent(exec, actor, o, true); }));
}

export async function reassignObligation(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  const prepared = content(input.prepared_by), reviewer = content(input.reviewer_id), reason = content(input.reason, "причину передачи");
  if (prepared === reviewer) invalid("Проверяющий отличается от подготовителя");
  return deps.db.transaction(exec => idempotent(exec, actor, `document.obligation.reassign:${id}`, key, input, async () => {
    const [initial] = await exec.query<Obligation>("select * from document_obligation where id=$1 and is_test=$2", [id, actor.person.isTest]);
    if (!initial) throw new ApiError("NOT_FOUND");
    const source = await parent(exec, actor, initial, true, true);
    const [row] = await exec.query<Obligation>("select * from document_obligation where id=$1 for update", [id]);
    checkVersion(row!.version, input.expected_version);
    if (row!.completed_at) throw new ApiError("INVALID_TRANSITION");
    await checkPeopleForObject(exec, actor, { ...row!, prepared_by: prepared, reviewer_id: reviewer }, source);
    const [updated] = await exec.query<Obligation>("update document_obligation set prepared_by=$2,reviewer_id=$3,document_version_id=null,reminded_at=null,escalated_at=null,version=version+1 where id=$1 returning *", [id, prepared, reviewer]);
    await recordAudit(deps, exec, actor, "document.obligation.reassign", "document_obligation", id, [],
      { prepared_by: row!.prepared_by, reviewer_id: row!.reviewer_id }, { prepared_by: prepared, reviewer_id: reviewer }, reason);
    return updated!;
  }, async () => { const [o] = await exec.query<Obligation>("select * from document_obligation where id=$1", [id]); if (!o) throw new ApiError("NOT_FOUND"); await parent(exec, actor, o, true); }));
}
