import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { canonical, content } from "../requests/service.ts";
import { actorForPerson } from "../documents/service.ts";
import { checkedDocumentVersions } from "../documents/provider.ts";
import { checkedFinancialPackage, financialInput, financialRuleInput, type FinancialInput } from "./financial.ts";

interface FinancialVersion extends Row {
  id: string; publication_id: string; version: number; obligation_id: string;
  period_from: string; period_to: string; report_version_id: string;
  title: string; body: string; building_ids: string[]; correction_note: string;
  package_snapshot: unknown; approval_id: string | null; published_at: string | null;
}
interface FinancialObligation extends Row {
  id: string; publication_id: string | null; is_test: boolean; building_ids: string[];
  period_from: string; period_to: string; prepared_by: string; reviewer_id: string; publisher_id: string;
  rule_snapshot: unknown; version: number;
}
export function assertFinancialSnapshot(saved: unknown, current: unknown) {
  if (canonical(jsonValue(saved)) !== canonical(current)) invalid("Комплект изменился: создайте новую версию и получите новое разрешение председателя");
}
async function publication(exec: DbExecutor, actor: Actor, id: string, action: "publication.manage" | "publication.approve") {
  const [row] = await exec.query<{ id: string; title: string; body: string; kind: string; is_test: boolean; state: string; financial_version_id: string | null }>("select * from publication where id=$1 for update", [id]);
  if (!row) throw new ApiError("NOT_FOUND");
  const scope = await exec.query<{ building_id: string }>("select building_id from publication_scope where publication_id=$1 order by building_id", [id]);
  const buildingIds = scope.map(s => s.building_id);
  if (row.kind !== "financial_report" || !can(actor, action, { publicationAccess: { buildingIds, isTest: row.is_test, published: false, member: false } }).allow) throw new ApiError("FORBIDDEN");
  return { row, buildingIds };
}
async function obligation(exec: DbExecutor, actor: Actor, id: string, publicationId: string) {
  const [row] = await exec.query<FinancialObligation>("select *,to_char(period_from,'YYYY-MM-DD') as period_from,to_char(period_to,'YYYY-MM-DD') as period_to from financial_obligation where id=$1", [id]);
  if (!row || row.is_test !== actor.person.isTest || (row.publication_id && row.publication_id !== publicationId)) invalid("Выберите обязанность этого финансового отчёта");
  return row;
}
async function packageSnapshot(exec: DbExecutor, actor: Actor, input: FinancialInput, duty: FinancialObligation, buildings: string[], title: string, body: string) {
  const snapshot = jsonValue<{ definition: Row }>(duty.rule_snapshot);
  const rule = financialRuleInput({ ...snapshot.definition, prepared_by: duty.prepared_by, reviewer_id: duty.reviewer_id, publisher_id: duty.publisher_id });
  if (canonical([...buildings].sort()) !== canonical([...duty.building_ids].sort())) invalid("Охват публикации должен соответствовать обязанности");
  const docs = await checkedDocumentVersions(exec, actor, [input.report_version_id, ...input.basis_versions.map(b => b.document_version_id)], buildings);
  return { title, body, ...checkedFinancialPackage(input, docs, { buildingIds: buildings, isTest: actor.person.isTest, rule, periodFrom: duty.period_from, periodTo: duty.period_to }),
    rule, time_rule_version_id: duty.time_rule_version_id };
}

/** Родитель publication блокируется первым, затем документы и обязанность. */
export async function prepareFinancialVersion(exec: DbExecutor, actor: Actor, id: string, raw: Row) {
  const { row, buildingIds } = await publication(exec, actor, id, "publication.manage");
  if (!["draft", "pending_approval", "published"].includes(row.state)) invalid("Сначала отмените отложенный выпуск или восстановите публикацию");
  const input = financialInput(raw), duty = await obligation(exec, actor, input.obligation_id, id);
  const [previous] = await exec.query<{ n: number; published: boolean; obligation_id: string | null }>("select coalesce(max(version),0)::integer as n,bool_or(published_at is not null) as published,min(obligation_id::text) as obligation_id from financial_publication_version where publication_id=$1", [id]);
  if (previous?.obligation_id && previous.obligation_id !== duty.id) invalid("Новый отчётный период оформляется отдельной публикацией; исправление сохраняет исходную обязанность");
  if (previous?.published && !input.correction_note) invalid("Укажите пояснение исправления опубликованного отчёта");
  const snapshot = await packageSnapshot(exec, actor, input, duty, buildingIds, row.title, row.body);
  // Повторяем проверку после блокировки: два разных отчёта не забирают одну обязанность.
  await exec.query("select id from financial_obligation where id=$1 for update", [duty.id]);
  if ((await obligation(exec, actor, duty.id, id)).version !== duty.version) throw new ApiError("CONCURRENT_MODIFICATION");
  await exec.query("update financial_obligation set publication_id=$2,completed_at=null,reminded_at=null,escalated_at=null,version=version+1 where id=$1", [duty.id, id]);
  const [version] = await exec.query<FinancialVersion>(`insert into financial_publication_version(publication_id,version,obligation_id,period_from,period_to,report_version_id,title,body,building_ids,correction_note,package_snapshot,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::jsonb,$12) returning *`,
    [id, (previous?.n ?? 0) + 1, duty.id, input.period_from, input.period_to, input.report_version_id, row.title, row.body, buildingIds, input.correction_note, JSON.stringify(snapshot), actor.person.id]);
  for (const part of [{ code: "report", document_version_id: input.report_version_id }, ...input.basis_versions]) await exec.query(
    "insert into financial_package_document(financial_version_id,document_version_id,code,disclosed) values($1,$2,$3,$4)", [version!.id, part.document_version_id, part.code, input.disclosed_version_ids.includes(part.document_version_id)]);
  await exec.query("update publication set financial_version_id=$2,approved_by=null,approval_note=null,state='draft',publish_at=null where id=$1", [id, version!.id]);
  return version!;
}

async function currentPackage(exec: DbExecutor, actor: Actor, id: string, action: "publication.manage" | "publication.approve") {
  const { row, buildingIds } = await publication(exec, actor, id, action);
  const [version] = await exec.query<FinancialVersion>("select *,to_char(period_from,'YYYY-MM-DD') as period_from,to_char(period_to,'YYYY-MM-DD') as period_to from financial_publication_version where publication_id=$1 and id=$2 for update", [id, row.financial_version_id]);
  if (!version) invalid("Сначала подготовьте версию финансового комплекта");
  if (version.title !== row.title || version.body !== row.body || canonical([...version.building_ids].sort()) !== canonical([...buildingIds].sort())) invalid("Текст и охват должны совпадать с зафиксированной версией");
  const parts = await exec.query<{ code: string; document_version_id: string; disclosed: boolean }>("select code,document_version_id,disclosed from financial_package_document where financial_version_id=$1 order by code", [version.id]);
  if (parts.find(p => p.code === "report")?.document_version_id !== version.report_version_id) invalid("Основной отчёт отсутствует в комплекте");
  const input = financialInput({ ...version, basis_versions: parts.filter(p => p.code !== "report"), disclosed_version_ids: parts.filter(p => p.disclosed).map(p => p.document_version_id) });
  const duty = await obligation(exec, actor, version.obligation_id, id);
  const snapshot = await packageSnapshot(exec, actor, input, duty, buildingIds, version.title, version.body);
  await exec.query("select id from financial_obligation where id=$1 for update", [duty.id]);
  if ((await obligation(exec, actor, duty.id, id)).version !== duty.version) throw new ApiError("CONCURRENT_MODIFICATION");
  assertFinancialSnapshot(version.package_snapshot, snapshot);
  return { version, snapshot, duty, row, buildingIds };
}

export async function approveFinancialVersion(exec: DbExecutor, actor: Actor, id: string, note: unknown) {
  const reason = content(note, "основание внешнего согласования");
  const { version, snapshot } = await currentPackage(exec, actor, id, "publication.approve");
  if (version.published_at) invalid("Опубликованная версия сохраняет своё разрешение");
  const [approval] = await exec.query<{ id: string }>("insert into financial_publication_approval(financial_version_id,actor_person_id,note,snapshot) values($1,$2,$3,$4::text::jsonb) returning id", [version.id, actor.person.id, reason, JSON.stringify(snapshot)]);
  await exec.query("update financial_publication_version set approval_id=$2 where id=$1", [version.id, approval!.id]);
  await exec.query("update publication set approved_by=$2,approval_note=$3 where id=$1", [id, actor.person.id, reason]);
  return approval!;
}

export async function checkFinancialRelease(exec: DbExecutor, actor: Actor, id: string) {
  const result = await currentPackage(exec, actor, id, "publication.manage");
  const [approval] = await exec.query<{ actor_person_id: string; snapshot: unknown }>("select actor_person_id,snapshot from financial_publication_approval where id=$1 and financial_version_id=$2", [result.version.approval_id, result.version.id]);
  if (!approval) invalid("Нужно разрешение председателя на эту версию комплекта");
  const chairman = await actorForPerson(exec, approval.actor_person_id, actor.person.isTest);
  if (!can(chairman, "publication.approve", { publicationAccess: { buildingIds: result.buildingIds, isTest: actor.person.isTest, published: false, member: false } }).allow) invalid("Разрешение выдано лицом без действующих полномочий председателя");
  assertFinancialSnapshot(approval.snapshot, result.snapshot);
  return result;
}

/** Проверка и все отметки выпуска выполняются в одной транзакции под теми же блокировками. */
export async function markFinancialPublished(exec: DbExecutor, actor: Actor, id: string) {
  const { version, duty } = await checkFinancialRelease(exec, actor, id);
  if (version.published_at) invalid("Эта версия уже опубликована");
  await exec.query("update financial_publication_version set replaced_at=now() where publication_id=$1 and published_at is not null and replaced_at is null and id<>$2", [id, version.id]);
  await exec.query("update financial_publication_version set published_at=now() where id=$1", [version.id]);
  await exec.query("update financial_obligation set active_version_id=$2,completed_at=null,reminded_at=null,escalated_at=null,version=version+1 where id=$1", [duty.id, version.id]);
}
