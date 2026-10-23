import { expect, it } from "vitest";
import type { DbClient } from "../../src/db/client.ts";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson, getDocument } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { fileUrl } from "../../src/domains/requests/files.ts";
import { getPublication, listPublications, savePublication, transitionPublication } from "../../src/domains/publications/service.ts";
import { publicationFile } from "../../src/domains/publications/media.ts";
import { checkedDocumentVersions } from "../../src/domains/documents/provider.ts";
import { checkFinancialRelease } from "../../src/domains/publications/financial-store.ts";
import { publishScheduled } from "../../src/domains/publications/jobs.ts";
import { fanoutBroadcasts } from "../../src/domains/incidents/broadcast.ts";

/** Только проверка ограничений схемы; бизнес-разрешение проверяет сервис FIN. */
async function schemaFixture(db: DbClient) {
  const publicationId = crypto.randomUUID(), otherPublicationId = crypto.randomUUID();
  await db.query("insert into publication(id,title,body,kind,is_test,created_by) values($1,'Отчёт','Период','financial_report',true,$3),($2,'Другой отчёт','Период','financial_report',true,$3)", [publicationId, otherPublicationId, SEED.testAdminPersonId]);
  await db.query("insert into publication_scope(publication_id,building_id) values($1,$2)", [publicationId, SEED.building1]);
  const [rule] = await db.query<{ id: string }>("insert into financial_rule(name,definition,is_test,created_by) values('Фикстура','{}',true,$1) returning id", [SEED.testAdminPersonId]);
  const [ruleVersion] = await db.query<{ id: string }>("insert into financial_rule_version(rule_id,version,definition,reason,created_by) values($1,1,'{}','Тест схемы',$2) returning id", [rule!.id, SEED.testAdminPersonId]);
  const [obligation] = await db.query<{ id: string }>(`insert into financial_obligation(financial_rule_version_id,period_from,period_to,building_ids,prepared_by,reviewer_id,publisher_id,time_rule_version_id,rule_snapshot,due_at,publication_id,is_test,created_by)
    values($1,'2026-09-01','2026-09-30',array[$2::uuid],$3,$4,$4,(select id from time_rule_version order by id limit 1),'{}',now(),$5,true,$4) returning id`, [ruleVersion!.id, SEED.building1, SEED.testExecutorPersonId, SEED.testAdminPersonId, publicationId]);
  const versions: string[] = [];
  for (const kind of ["financial_report", "decision_basis"]) {
    const [doc] = await db.query<{ id: string }>("insert into document(title,kind,audience,document_date,prepared_by,reviewer_id,created_by,is_test) values('Фикстура',$1,'owner',current_date,$2,$3,$3,true) returning id", [kind, SEED.testExecutorPersonId, SEED.testAdminPersonId]);
    const [file] = await db.query<{ id: string }>("insert into attachment(owner_type,owner_id,bucket,storage_path,filename,size_bytes,mime,status,uploaded_by) values('document',$1,'resident',$2,'fixture.pdf',10,'application/pdf','complete',$3) returning id", [doc!.id, crypto.randomUUID(), SEED.testExecutorPersonId]);
    const [version] = await db.query<{ id: string }>("insert into document_version(document_id,version,attachment_id,prepared_by) values($1,1,$2,$3) returning id", [doc!.id, file!.id, SEED.testExecutorPersonId]);
    versions.push(version!.id);
  }
  async function version(number: number, pub = publicationId) {
    const [row] = await db.query<{ id: string; approval_id: string | null }>(`insert into financial_publication_version(publication_id,version,obligation_id,period_from,period_to,report_version_id,title,body,building_ids,package_snapshot,created_by)
      values($1,$2,$3,'2026-09-01','2026-09-30',$4,'Отчёт','Период',array[$5::uuid],'{}',$6) returning id,approval_id`, [pub, number, obligation!.id, versions[0], SEED.building1, SEED.testAdminPersonId]);
    return row!;
  }
  return { publicationId, otherPublicationId, obligationId: obligation!.id, versions, version };
}

async function businessFixture(db: DbClient) {
    const s = await schemaFixture(db);
    await db.query("insert into staff_assignment(person_id,role) values($1,'chairman')", [SEED.testAdminPersonId]);
    const chairman = await actorForPerson(db, SEED.testAdminPersonId, true);
    await db.query("update document_version set state='on_review' where id=any($1::uuid[])", [s.versions]);
    await db.query("update document_version set state='approved',reviewed_by=$2,reviewed_at=now() where id=any($1::uuid[])", [s.versions, SEED.testAdminPersonId]);
    const rule = { name: "Тест", form: "monthly", form_description: "Тестовая форма", building_ids: [SEED.building1],
      prepared_by: SEED.testExecutorPersonId, reviewer_id: SEED.testAdminPersonId, publisher_id: SEED.testAdminPersonId,
      required_agreements: [{ code: "council", label: "Совет", kind: "decision_basis", signed_required: false }], channels: ["bot"], report_signed_required: false };
    // Условия обязанности неизменяемы: формируем отдельную корректную обязанность.
    const [old] = await db.query<Record<string, unknown>>("select * from financial_obligation where id=$1", [s.obligationId]);
    const [obligation] = await db.query<{ id: string }>(`insert into financial_obligation(financial_rule_version_id,period_from,period_to,building_ids,prepared_by,reviewer_id,publisher_id,time_rule_version_id,rule_snapshot,due_at,publication_id,is_test,created_by)
      values($1,'2026-10-01','2026-10-31',array[$2::uuid],$3,$4,$4,$5,$6::text::jsonb,now(),$7,true,$4) returning id`,
      [old!.financial_rule_version_id, SEED.building1, SEED.testExecutorPersonId, SEED.testAdminPersonId, old!.time_rule_version_id, JSON.stringify({ definition: rule }), s.publicationId]);
    const input = { obligation_id: obligation!.id, period_from: "2026-10-01", period_to: "2026-10-31", report_version_id: s.versions[0], basis_versions: [{ code: "council", document_version_id: s.versions[1] }], disclosed_version_ids: [s.versions[0]], correction_note: "", reason: "Проверка финансового комплекта" };
    const deps = { db, audit: new SqlAuditRepo() };
    return { s, chairman, input, deps };
}

describeWithDb("FIN-01…04: изоляция и неизменяемость версии комплекта", getDb => {
  it("одновременные разрешение и замена комплекта сохраняют одно решение и один конфликт", async () => {
    const db = getDb(), { s, chairman, input, deps } = await businessFixture(db);
    const values = { ...input, expected_version: 1, title: "Отчёт", body: "Период", kind: "financial_report", requires_document: true, building_ids: [SEED.building1] };
    const saved = await savePublication(deps, chairman, s.publicationId, values, "race-save");
    const pending = await transitionPublication(deps, chairman, s.publicationId, { action: "submit_approval", expected_version: saved.version, reason: "Проверка гонки" }, "race-submit");
    const outcomes = await Promise.allSettled([
      transitionPublication(deps, chairman, s.publicationId, { action: "approve", expected_version: pending.version, approval_note: "Внешние основания проверены", reason: "Проверка гонки" }, "race-approve"),
      savePublication(deps, chairman, s.publicationId, { ...values, expected_version: pending.version, title: "Другая редакция" }, "race-replace"),
    ]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "CONCURRENT_MODIFICATION" } });
    const [head] = await db.query<{ title: string; approval_id: string | null }>("select f.title,f.approval_id from publication p join financial_publication_version f on f.id=p.financial_version_id where p.id=$1", [s.publicationId]);
    if (head!.title === "Другая редакция") expect(head!.approval_id).toBeNull();
    else expect(head!.approval_id).toBeTruthy();
    expect(await db.query("select id from publication_log where publication_id=$1 and version=$2", [s.publicationId, pending.version + 1])).toHaveLength(1);
  }, 600_000);
  it("плановый выпуск повторяет проверку комплекта и не повторяет публикацию", async () => {
    const db = getDb(), { s, chairman, input, deps } = await businessFixture(db);
    let row = await savePublication(deps, chairman, s.publicationId, { ...input, expected_version: 1, title: "Отчёт", body: "Период", kind: "financial_report", requires_document: true, building_ids: [SEED.building1] }, "scheduled-save");
    async function transition(action: string, values = {}) {
      row = await transitionPublication(deps, chairman, s.publicationId, { ...values, action, expected_version: row.version, reason: "Проверка планового выпуска" }, crypto.randomUUID());
    }
    async function schedule() {
      await transition("submit_approval");
      await transition("approve", { approval_note: "Внешние основания проверены" });
      await transition("schedule", { publish_at: new Date(Date.now() + 86_400_000).toISOString() });
      expect(row.scheduled_by).toBe(chairman.person.id);
      await db.query("update publication set publish_at=now()-interval '1 minute' where id=$1", [s.publicationId]);
    }
    await schedule();
    expect(await publishScheduled(deps, Date.now() + 120_000)).toBe(1);
    expect(await publishScheduled(deps, Date.now() + 120_000)).toBe(0);
    const [published] = await db.query<{ version: number }>("select version from publication where id=$1", [s.publicationId]);
    row = await savePublication(deps, chairman, s.publicationId, { ...input, expected_version: published!.version, title: "Исправление", body: "Период", kind: "financial_report", requires_document: true, building_ids: [SEED.building1], correction_note: "Повторная внешняя проверка" }, "scheduled-correction");
    await schedule();
    await db.query("update document_version set state='needs_fix' where id=$1", [s.versions[1]]);
    expect(await publishScheduled(deps, Date.now() + 120_000)).toBe(0);
    expect(await db.query("select id from financial_publication_version where publication_id=$1 and published_at is not null", [s.publicationId])).toHaveLength(1);
    expect(await db.query("select id from broadcast where publication_id=$1", [s.publicationId])).toHaveLength(1);
    expect(await db.query("select id from publication_log where publication_id=$1 and action='schedule_blocked'", [s.publicationId])).toHaveLength(1);
    const [blocked] = await db.query<{ version: number; state: string }>("select version,state from publication where id=$1", [s.publicationId]);
    expect(blocked!.state).toBe("draft");
    await expect(transitionPublication(deps, chairman, s.publicationId, { action: "publish", expected_version: blocked!.version, reason: "Повторная проверка" }, "blocked-immediate")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  }, 600_000);
  it("разрешает только зафиксированный комплект; исправление и needs_fix требуют нового разрешения", async () => {
    const db = getDb(), { s, chairman, input, deps } = await businessFixture(db);
    const saved = await savePublication(deps, chairman, s.publicationId, { ...input, expected_version: 1, title: "Отчёт", body: "Период", kind: "financial_report", requires_document: true, building_ids: [SEED.building1] }, "save-package");
    expect(saved.financial_version_id).toBeTruthy();
    const [version] = await db.query<{ id: string; version: number }>("select id,version from financial_publication_version where id=$1", [saved.financial_version_id]);
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const submitted = await transitionPublication(deps, chairman, s.publicationId, { action: "submit_approval", expected_version: saved.version, reason: "Передача председателю" }, "submit-package");
    const approved = await transitionPublication(deps, chairman, s.publicationId, { action: "approve", expected_version: submitted.version, approval_note: "Внешнее согласование подтверждено", reason: "Разрешение на выпуск" }, "approve-package");
    await db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId));
    await db.query("update staff_assignment set status='revoked' where person_id=$1 and role='chairman'", [SEED.testAdminPersonId]);
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await db.query("update staff_assignment set status='active' where person_id=$1 and role='chairman'", [SEED.testAdminPersonId]);
    const published = await transitionPublication(deps, chairman, s.publicationId, { action: "publish", expected_version: approved.version, reason: "Размещение отчёта" }, "publish-package");
    for (const [building, person] of [[SEED.building1, SEED.testAdminPersonId], [SEED.building2, SEED.testExecutorPersonId]]) {
      const [premises] = await db.query<{ id: string }>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','FIN-test',true) returning id", [building]);
      await db.query("insert into connection(person_id,premises_id,role,basis,status,confirmed_by,confirmed_at) values($1,$2,'owner','ownership','active',$3,now())", [person, premises!.id, SEED.testAdminPersonId]);
    }
    await db.query("insert into connection(person_id,premises_id,role,basis,status,confirmed_by,confirmed_at) select $1,id,'tenant','rent','active',$2,now() from premises where building_id=$3 and number='FIN-test'", [SEED.testExecutorPersonId, SEED.testAdminPersonId, SEED.building1]);
    await fanoutBroadcasts(deps, Date.now() + 120_000);
    const recipients = await db.query<{ recipient: string }>("select payload->>'personId' as recipient from outbox where payload->>'publicationId'=$1", [s.publicationId]);
    expect(recipients.map(r => r.recipient)).toEqual([SEED.testAdminPersonId]);
    const owner = { ...chairman, assignments: [] }, otherOwner = { ...await actorForPerson(db, SEED.testExecutorPersonId, true), assignments: [] };
    const [report] = await db.query<{ document_id: string; attachment_id: string; was_published: boolean }>("select document_id,attachment_id,was_published from document_version where id=$1", [s.versions[0]]);
    expect(report!.was_published).toBe(false); // FIN не расширяет самостоятельную аудиторию документа.
    expect((await getDocument(deps, owner, report!.document_id)).versions).toHaveLength(1);
    expect(await getPublication(deps, owner, s.publicationId)).toMatchObject({ title: "Отчёт", state: "published", financial_versions: [{ version: 1 }] });
    expect(JSON.stringify(await getPublication(deps, owner, s.publicationId))).not.toContain(s.versions[1]);
    await expect(getPublication(deps, otherOwner, s.publicationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDocument(deps, otherOwner, report!.document_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const storage = { async sign() { return "https://files.invalid/report"; }, async put() {}, async info() { return { size: 10, mime: "application/pdf" }; } };
    expect(await fileUrl(deps, storage, owner, report!.attachment_id)).toMatchObject({ expires_in: 300 });
    expect(await publicationFile(deps, storage, owner, s.publicationId, report!.attachment_id)).toMatchObject({ expires_in: 300 });
    const [basis] = await db.query<{ attachment_id: string }>("select attachment_id from document_version where id=$1", [s.versions[1]]);
    await expect(publicationFile(deps, storage, owner, s.publicationId, basis!.attachment_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fileUrl(deps, storage, otherOwner, report!.attachment_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const correctionInput = { ...input, expected_version: published.version, title: "Черновик исправления", body: "Период", kind: "financial_report", requires_document: true, building_ids: [SEED.building1] };
    await expect(savePublication(deps, chairman, s.publicationId, correctionInput, "correction-no-reason")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const correction = await savePublication(deps, chairman, s.publicationId, { ...correctionInput, correction_note: "Исправлена сумма во внешнем отчёте" }, "correction-save");
    const [correctedVersion] = await db.query<{ version: number }>("select version from financial_publication_version where id=$1", [correction.financial_version_id]);
    expect(correctedVersion!.version).toBe(version!.version + 1);
    expect(await getPublication(deps, owner, s.publicationId)).toMatchObject({ title: "Отчёт", financial_versions: [{ version: 1 }] });
    expect((await listPublications(deps, owner)).find(p => p.id === s.publicationId)).toMatchObject({ title: "Отчёт", body: "Период", version: 1 });
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const submittedCorrection = await transitionPublication(deps, chairman, s.publicationId, { action: "submit_approval", expected_version: correction.version, reason: "Передача исправления" }, "submit-correction");
    const approvedCorrection = await transitionPublication(deps, chairman, s.publicationId, { action: "approve", expected_version: submittedCorrection.version, approval_note: "Повторно разрешено", reason: "Разрешение исправления" }, "approve-correction");
    await transitionPublication(deps, chairman, s.publicationId, { action: "publish", expected_version: approvedCorrection.version, reason: "Размещение исправления" }, "publish-correction");
    const archive = await getPublication(deps, owner, s.publicationId);
    expect(archive).toMatchObject({ title: "Черновик исправления", financial_versions: [{ version: 2 }, { version: 1, replaced_at: expect.anything() }] });
    await db.query("update document_version set state='needs_fix' where id=$1", [s.versions[1]]);
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await db.query("select id from financial_publication_version where publication_id=$1 and published_at is not null", [s.publicationId])).toHaveLength(2);
  }, 600_000);
  it("провайдер проверяет конкретные версии, область, исходный PDP и состояние файла", async () => {
    const db = getDb(), s = await schemaFixture(db);
    await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')", [SEED.testAdminPersonId]);
    const admin = await actorForPerson(db, SEED.testAdminPersonId, true);
    await db.query("update document_version set state='on_review' where id=any($1::uuid[])", [s.versions]);
    await db.query("update document_version set state='approved',reviewed_by=$2,reviewed_at=now() where id=any($1::uuid[])", [s.versions, SEED.testAdminPersonId]);
    const checked = await db.transaction(exec => checkedDocumentVersions(exec, admin, s.versions, [SEED.building1]));
    expect(checked.map(d => d.id).sort()).toEqual([...s.versions].sort());
    expect(checked.every(d => d.state === "approved" && d.attachment_id && d.document_date)).toBe(true);
    const resident = { ...admin, assignments: [] };
    await expect(db.transaction(exec => checkedDocumentVersions(exec, resident, s.versions, [SEED.building1]))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.query("update document_version set state='needs_fix' where id=$1", [s.versions[1]]);
    await expect(db.transaction(exec => checkedDocumentVersions(exec, admin, s.versions, [SEED.building1]))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  }, 300_000);
  it("все финансовые таблицы закрыты от прямых клиентов", async () => {
    const tables = ["financial_rule", "financial_rule_version", "financial_obligation", "financial_publication_version", "financial_publication_approval", "financial_package_document", "financial_placement", "financial_issue", "publication_document"];
    const rows = await getDb().query<{ relrowsecurity: boolean; exposed: boolean }>(`select c.relrowsecurity,
      has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT') as exposed
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])`, [tables]);
    expect(rows).toHaveLength(tables.length);
    expect(rows.every(r => r.relrowsecurity && !r.exposed)).toBe(true);
  });
  it("разрешённый комплект нельзя дописать, а новая версия не наследует разрешение", async () => {
    const db = getDb(), s = await schemaFixture(db), first = await s.version(1);
    await db.query("insert into financial_package_document(financial_version_id,document_version_id,code,disclosed) values($1,$2,'report',true)", [first.id, s.versions[0]]);
    const [approval] = await db.query<{ id: string }>("insert into financial_publication_approval(financial_version_id,actor_person_id,note,snapshot) values($1,$2,'Тестовое разрешение','{}') returning id", [first.id, SEED.testAdminPersonId]);
    await db.query("update financial_publication_version set approval_id=$2 where id=$1", [first.id, approval!.id]);
    await expect(db.query("insert into financial_package_document(financial_version_id,document_version_id,code,disclosed) values($1,$2,'extra',true)", [first.id, s.versions[1]])).rejects.toThrow(/immutable/);
    await expect(db.query("update financial_package_document set disclosed=false where financial_version_id=$1", [first.id])).rejects.toThrow(/append-only/);
    const second = await s.version(2);
    expect(second.approval_id).toBeNull();
    await expect(db.query("update financial_publication_version set approval_id=$2 where id=$1", [second.id, approval!.id])).rejects.toMatchObject({ code: "23503" });
    await expect(db.query("update financial_publication_version set published_at=now() where id=$1", [second.id])).rejects.toMatchObject({ code: "23514" });
  });
  it("обязанность и её активная версия принадлежат одной публикации", async () => {
    const db = getDb(), s = await schemaFixture(db), version = await s.version(1);
    await db.query("update financial_obligation set active_version_id=$2 where id=$1", [s.obligationId, version.id]);
    await expect(s.version(2, s.otherPublicationId)).rejects.toMatchObject({ code: "23503" });
    await expect(db.query("update financial_publication_version set title='Подмена' where id=$1", [version.id])).rejects.toThrow(/immutable/);
  });
});
