import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { SqlAdminRepo } from "../admin/repo.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { documentInput, versionInput } from "./input.ts";
import { documentResource, documentResources, internalDocumentReader, requireDocument } from "./access.ts";
import { documentTransition } from "./fsm.ts";
import type { DocumentRow, DocumentVersionRow } from "./types.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import { templateNotice } from "../../templates/notice.ts";
import { requireTask } from "../tasks/access.ts";
import { requireRequest } from "../requests/access.ts";

async function log(deps: RegistryDeps, exec: DbExecutor, actor: Actor, row: DocumentRow,
  action: string, reason: string, versionId: string | null = null) {
  await exec.query("insert into document_log(document_id,document_version_id,action,actor_person_id,reason) values($1,$2,$3,$4,$5)",
    [row.id, versionId, action, actor.person.id, reason]);
  const [updated] = await exec.query<DocumentRow>("update document set version=version+1 where id=$1 returning *", [row.id]);
  const scope = await exec.query<{ building_id: string }>("select building_id from document_scope where document_id=$1", [row.id]);
  await recordAudit(deps, exec, actor, `document.${action}`, "document", row.id, scope.map(s => s.building_id),
    { version: row.version }, { version: updated!.version, document_version_id: versionId }, reason);
  return updated!;
}
export async function actorForPerson(exec: DbExecutor, personId: string, isTest: boolean): Promise<Actor> {
  const [profile] = await exec.query<{ id: string }>("select id from profile where person_id=$1 and archived_at is null and is_test=$2 order by id limit 1", [personId, isTest]);
  if (!profile) invalid("Выберите действующего зарегистрированного сотрудника");
  const repo = new SqlAdminRepo(), p = await repo.getProfile(exec, profile.id);
  if (!p) invalid("Профиль сотрудника недоступен");
  return buildActorForProfile(repo, exec, p, new Date());
}

export async function createDocument(deps: RegistryDeps, actor: Actor, input: Row, key: unknown) {
  const data = documentInput(input), reason = content(input.reason, "причину");
  return deps.db.transaction(exec => idempotent(exec, actor, "document.create", key, input, async () => {
    let sourceScope: string[] | null = null;
    if (data.task_id) sourceScope = (await requireTask(exec, actor, data.task_id)).building_ids;
    else if (data.request_id) {
      const source = await requireRequest(exec, actor, data.request_id);
      sourceScope = source.building_id ? [source.building_id] : [];
    }
    if (sourceScope) {
      if (data.building_ids.length && JSON.stringify([...data.building_ids].sort()) !== JSON.stringify([...sourceScope].sort())) invalid("Дома документа должны соответствовать исходному объекту");
      data.building_ids = sourceScope;
    }
    if ((await exec.query("select id from building where id=any($1::uuid[])", [data.building_ids])).length !== data.building_ids.length) invalid("Дом документа недоступен");
    const [row] = await exec.query<DocumentRow>(
      `insert into document(title,kind,audience,document_number,document_date,parties,request_id,task_id,prepared_by,reviewer_id,created_by,is_test)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [data.title, data.kind, data.audience, data.document_number, data.document_date, data.parties, data.request_id, data.task_id, data.prepared_by, data.reviewer_id, actor.person.id, actor.person.isTest]);
    for (const id of data.building_ids) await exec.query("insert into document_scope(document_id,building_id) values($1,$2)", [row!.id, id]);
    await requireDocument(exec, actor, row!.id, "document.prepare");
    for (const [personId, action] of [[data.prepared_by, "document.prepare"], [data.reviewer_id, "document.review"]] as const) {
      const candidate = await actorForPerson(exec, personId, row!.is_test);
      if (!can(candidate, action, await documentResource(exec, candidate, row!)).allow) invalid("Подготовитель или проверяющий не имеет полномочий на этот документ");
    }
    await log(deps, exec, actor, row!, "created", reason);
    return requireDocument(exec, actor, row!.id);
  }, row => requireDocument(exec, actor, row.id, "document.prepare")));
}

export async function addDocumentVersion(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  const data = versionInput(input), reason = content(input.reason, "причину");
  return deps.db.transaction(exec => idempotent(exec, actor, `document.version:${id}`, key, input, async () => {
    const row = await requireDocument(exec, actor, id, "document.prepare", true);
    checkVersion(row.version, input.expected_version);
    const files = [data.attachment_id, ...(data.signed_attachment_id ? [data.signed_attachment_id] : [])].sort();
    const found = await exec.query<Row>("select * from attachment where id=any($1::uuid[]) order by id for update", [files]);
    if (found.length !== files.length || found.some(f => f.owner_type !== "document" || f.owner_id !== id || f.status !== "complete")) invalid("Выберите сохранённые файлы этого документа");
    if ((await exec.query("select id from document_version where attachment_id=any($1::uuid[]) or signed_attachment_id=any($1::uuid[])", [files])).length) invalid("Файл версии уже использован; загрузите новый экземпляр");
    const [version] = await exec.query<DocumentVersionRow>(
      `insert into document_version(document_id,version,attachment_id,signed_attachment_id,signature_method,signature_basis,prepared_by,task_report_id)
       select $1,coalesce(max(version),0)+1,$2,$3,$4,$5,$6,
        (select id from task_report where task_id=$7 order by version desc limit 1)
       from document_version where document_id=$1 returning *`,
      [id, data.attachment_id, data.signed_attachment_id, data.signature_method, data.signature_basis, actor.person.id, row.task_id]);
    await log(deps, exec, actor, row, "version_created", reason, version!.id);
    return version!;
  }, () => requireDocument(exec, actor, id, "document.prepare")));
}

export async function transitionDocumentVersion(deps: RegistryDeps, actor: Actor, id: string, number: number, action: string, input: Row, key: unknown) {
  const reason = content(input.reason, "причину"), preparing = action === "submit";
  if (!Number.isSafeInteger(number) || number < 1) invalid("Некорректная версия документа");
  return deps.db.transaction(exec => idempotent(exec, actor, `document.${action}:${id}:${number}`, key, input, async () => {
    const row = await requireDocument(exec, actor, id, preparing ? "document.prepare" : "document.review", true);
    checkVersion(row.version, input.expected_version);
    const [version] = await exec.query<DocumentVersionRow>("select * from document_version where document_id=$1 and version=$2 for update", [id, number]);
    if (!version) throw new ApiError("NOT_FOUND");
    if (preparing && row.task_id && ["act", "work_report"].includes(row.kind)) {
      const [report] = await exec.query<{ id: string }>("select id from task_report where task_id=$1 order by version desc limit 1", [row.task_id]);
      if (!report || report.id !== version.task_report_id) invalid("Создайте новую версию документа по актуальному отчёту задания");
    }
    if (!preparing && version.prepared_by === actor.person.id) throw new ApiError("FORBIDDEN", "Нельзя проверять собственный документ");
    const state = documentTransition(version.state, action);
    const [updated] = await exec.query<DocumentVersionRow>(
      "update document_version set state=$2,reviewed_by=case when $3 then reviewed_by else $4 end,reviewed_at=case when $3 then reviewed_at else now() end,review_comment=$5 where id=$1 returning *",
      [version.id, state, preparing, actor.person.id, reason]);
    await log(deps, exec, actor, row, action, reason, version.id);
    if (action === "needs_fix") await exec.query("update document_obligation set completed_at=null,reminded_at=null,escalated_at=null,version=version+1 where document_version_id=$1", [version.id]);
    const labels: Record<string, [string, string]> = {
      on_review: ["На проверке", "Тексеруде"], approved: ["Проверен", "Тексерілді"],
      returned: ["Возвращён", "Қайтарылды"], needs_fix: ["Требует исправления", "Түзету қажет"],
    };
    const label = labels[state]!;
    await notifyPerson(exec, preparing ? row.reviewer_id : row.prepared_by,
      templateNotice("notices.documents.changed", { title: row.title, state_ru: label[0], state_kk: label[1] }),
      `document:${version.id}:${action}`, { documentId: id, isTest: row.is_test, bot: "worker", important: true });
    return updated!;
  }, () => requireDocument(exec, actor, id, preparing ? "document.prepare" : "document.review")));
}

export async function publishDocument(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  const reason = content(input.reason, "причину");
  return deps.db.transaction(exec => idempotent(exec, actor, `document.publish:${id}`, key, input, async () => {
    const row = await requireDocument(exec, actor, id, "document.manage", true);
    checkVersion(row.version, input.expected_version);
    if (row.kind === "financial_report") invalid("Финансовый отчёт публикуется с комплектом оснований и разрешением председателя через публикации");
    const [v] = await exec.query<DocumentVersionRow>("select * from document_version where document_id=$1 and id=$2 for update", [id, content(input.document_version_id)]);
    if (!v || v.state !== "approved") invalid("Публикуется только проверенная версия");
    await exec.query("update document_version set was_published=true where id=$1", [v.id]);
    await exec.query("update document set published_version_id=$2 where id=$1", [id, v.id]);
    return log(deps, exec, actor, row, "published", reason, v.id);
  }, () => requireDocument(exec, actor, id, "document.manage")));
}

export async function getDocument(deps: RegistryDeps, actor: Actor, id: string) {
  const row = await requireDocument(deps.db, actor, id);
  const resource = await documentResource(deps.db, actor, row);
  const internal = internalDocumentReader(actor, resource);
  const versions = await deps.db.query<DocumentVersionRow>("select * from document_version where document_id=$1 and ($2 or was_published or ($3 and state='approved') or id=any($4::uuid[])) order by version desc", [id, internal, resource.documentAccess!.assignedTask && !resource.documentAccess!.financial, resource.documentAccess!.financialVersionIds ?? []]);
  const scope = await deps.db.query<{ building_id: string }>("select building_id from document_scope where document_id=$1 order by building_id", [id]);
  const history = internal ? await deps.db.query("select action,document_version_id,reason,at from document_log where document_id=$1 order by id", [id]) : [];
  const visible = internal ? row : { id: row.id, title: row.title, kind: row.kind, audience: row.audience, version: row.version,
    document_date: row.document_date, document_number: row.document_number, parties: row.parties, published_version_id: row.published_version_id };
  return { ...visible, versions: internal ? versions : versions.map(v => ({ id: v.id, version: v.version, state: v.state, attachment_id: v.attachment_id, signed_attachment_id: v.signed_attachment_id })),
    history, building_ids: scope.map(s => s.building_id),
    can_prepare: can(actor, "document.prepare", resource).allow, can_review: can(actor, "document.review", resource).allow,
    can_manage: can(actor, "document.manage", resource).allow };
}
export async function listDocuments(deps: RegistryDeps, actor: Actor, offset = 0, limit = 50) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalid("Некорректная страница");
  // Пагинация после PDP: количество и границы страниц не раскрывают скрытые документы.
  const rows = await deps.db.query<DocumentRow>("select * from document where is_test=$1 order by created_at desc,id", [actor.person.isTest]);
  const resources = await documentResources(deps.db, actor, rows);
  const allowed = rows.filter((_, i) => can(actor, "document.read", resources[i]).allow);
  return { items: allowed.slice(offset, offset + limit).map(r => ({ id: r.id, title: r.title, kind: r.kind, audience: r.audience, version: r.version, document_date: r.document_date, published_version_id: r.published_version_id })), total: allowed.length };
}
