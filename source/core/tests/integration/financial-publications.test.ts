import { expect, it } from "vitest";
import type { DbClient } from "../../src/db/client.ts";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson, getDocument } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { fileUrl } from "../../src/domains/requests/files.ts";
import { checkedDocumentVersions } from "../../src/domains/documents/provider.ts";
import { prepareFinancialVersion, approveFinancialVersion, checkFinancialRelease, markFinancialPublished } from "../../src/domains/publications/financial-store.ts";

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

describeWithDb("FIN-01…04: изоляция и неизменяемость версии комплекта", getDb => {
  it("разрешает только зафиксированный комплект; исправление и needs_fix требуют нового разрешения", async () => {
    const db = getDb(), s = await schemaFixture(db);
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
    const input = { obligation_id: obligation!.id, period_from: "2026-10-01", period_to: "2026-10-31", report_version_id: s.versions[0], basis_versions: [{ code: "council", document_version_id: s.versions[1] }], disclosed_version_ids: [s.versions[0]], correction_note: "" };
    const version = await db.transaction(exec => prepareFinancialVersion(exec, chairman, s.publicationId, input));
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await db.transaction(exec => approveFinancialVersion(exec, chairman, s.publicationId, "Внешнее согласование подтверждено"));
    await db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId));
    await db.transaction(exec => markFinancialPublished(exec, chairman, s.publicationId));
    for (const [building, person] of [[SEED.building1, SEED.testAdminPersonId], [SEED.building2, SEED.testExecutorPersonId]]) {
      const [premises] = await db.query<{ id: string }>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','FIN-test',true) returning id", [building]);
      await db.query("insert into connection(person_id,premises_id,role,basis,status,confirmed_by,confirmed_at) values($1,$2,'owner','ownership','active',$3,now())", [person, premises!.id, SEED.testAdminPersonId]);
    }
    const owner = { ...chairman, assignments: [] }, otherOwner = { ...await actorForPerson(db, SEED.testExecutorPersonId, true), assignments: [] };
    const [report] = await db.query<{ document_id: string; attachment_id: string; was_published: boolean }>("select document_id,attachment_id,was_published from document_version where id=$1", [s.versions[0]]);
    const deps = { db, audit: new SqlAuditRepo() };
    expect(report!.was_published).toBe(false); // FIN не расширяет самостоятельную аудиторию документа.
    expect((await getDocument(deps, owner, report!.document_id)).versions).toHaveLength(1);
    await expect(getDocument(deps, otherOwner, report!.document_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const storage = { async sign() { return "https://files.invalid/report"; }, async put() {}, async info() { return { size: 10, mime: "application/pdf" }; } };
    expect(await fileUrl(deps, storage, owner, report!.attachment_id)).toMatchObject({ expires_in: 300 });
    await expect(fileUrl(deps, storage, otherOwner, report!.attachment_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(db.transaction(exec => prepareFinancialVersion(exec, chairman, s.publicationId, input))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const correction = await db.transaction(exec => prepareFinancialVersion(exec, chairman, s.publicationId, { ...input, correction_note: "Исправлена сумма во внешнем отчёте" }));
    expect(correction.version).toBe(version.version + 1);
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await db.transaction(exec => approveFinancialVersion(exec, chairman, s.publicationId, "Повторно разрешено"));
    await db.query("update document_version set state='needs_fix' where id=$1", [s.versions[1]]);
    await expect(db.transaction(exec => checkFinancialRelease(exec, chairman, s.publicationId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await db.query("select id from financial_publication_version where publication_id=$1 and published_at is not null", [s.publicationId])).toHaveLength(1);
  }, 300_000);
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
