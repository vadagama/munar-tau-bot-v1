import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { saveFinancialRule, listFinancialRules } from "../../src/domains/publications/financial-rules.ts";
import { makeTestActor } from "../../src/testing/actors.ts";
import { createFinancialObligation, reassignFinancialObligation } from "../../src/domains/publications/financial-obligations.ts";

describeWithDb("FIN-04: версионный регламент", getDb => {
  it("фиксирует период и срок TIM; передача не меняет срок и исходный регламент", async () => {
    const db = getDb(), deps = { db, audit: new SqlAuditRepo() };
    await db.query("insert into staff_assignment(person_id,role) values($1,'chairman'),($2,'administrator')", [SEED.testAdminPersonId, SEED.testExecutorPersonId]);
    const actor = await actorForPerson(db, SEED.testAdminPersonId, true);
    const definition = { name: "Тестовый FIN", form: "monthly", form_description: "Sydney, не норматив ОСИ", building_ids: [SEED.building1],
      prepared_by: SEED.testExecutorPersonId, reviewer_id: SEED.testAdminPersonId, publisher_id: SEED.testAdminPersonId,
      required_agreements: [{ code: "council", label: "Решение", kind: "decision_basis", signed_required: true }], channels: ["site"], report_signed_required: true, reason: "Тест" };
    const rule = await saveFinancialRule(deps, actor, null, definition, "duty-rule");
    const configure = (hours: number) => db.query(`insert into time_rule_version(rule_id,version,params,reason,created_by)
      select r.id,coalesce((select max(version) from time_rule_version where rule_id=r.id),0)+1,$1::text::jsonb,'Тест Sydney',$2
      from time_rule r where key='financial_monthly_publication'`, [JSON.stringify({ hours, clock: "calendar" }), actor.person.id]);
    await configure(24);
    const input = { rule_id: rule.id, expected_version: rule.version, period_from: "2026-09-01", period_to: "2026-09-30", reason: "Обязанность за сентябрь" };
    const duty = await createFinancialObligation(deps, actor, input, "duty-create");
    expect(new Date(duty.due_at).toISOString()).toBe("2026-10-01T19:00:00.000Z");
    expect((await createFinancialObligation(deps, actor, input, "duty-create")).id).toBe(duty.id);
    await configure(48);
    await saveFinancialRule(deps, actor, rule.id, { ...definition, expected_version: rule.version, channels: ["site", "bot"] }, "change-duty-rule");
    const moved = await reassignFinancialObligation(deps, actor, duty.id, { prepared_by: SEED.testAdminPersonId, reviewer_id: SEED.testExecutorPersonId, publisher_id: SEED.testExecutorPersonId, expected_version: duty.version, reason: "Передача" }, "move-duty");
    expect(moved.due_at).toEqual(duty.due_at);
    expect(moved.rule_snapshot).toEqual(duty.rule_snapshot);
    expect(moved.time_rule_version_id).toBe(duty.time_rule_version_id);
    expect(moved.version).toBe(duty.version + 1);
    await expect(reassignFinancialObligation(deps, actor, duty.id, { prepared_by: SEED.testAdminPersonId, reviewer_id: SEED.testExecutorPersonId, publisher_id: SEED.testExecutorPersonId, expected_version: duty.version, reason: "Старая форма" }, "stale-duty")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    await expect(createFinancialObligation(deps, actor, { ...input, period_to: "2026-02-31" }, "bad-period")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  }, 600_000);
  it("сохраняет снимки, повторы и конфликт; техническая роль и отозванный подготовитель не обходят PDP", async () => {
    const db = getDb(), deps = { db, audit: new SqlAuditRepo() };
    await db.query("insert into staff_assignment(person_id,role) values($1,'chairman'),($2,'administrator')", [SEED.testAdminPersonId, SEED.testExecutorPersonId]);
    const chairman = await actorForPerson(db, SEED.testAdminPersonId, true);
    const input = { name: "Месячный регламент", form: "monthly", form_description: "Только тестовая форма Sydney", building_ids: [SEED.building1],
      prepared_by: SEED.testExecutorPersonId, reviewer_id: SEED.testAdminPersonId, publisher_id: SEED.testAdminPersonId,
      required_agreements: [{ code: "council", label: "Решение совета", kind: "decision_basis", signed_required: true }],
      channels: ["bot", "site"], report_signed_required: true, reason: "Тестовая конфигурация", is_test: false };
    const first = await saveFinancialRule(deps, chairman, null, input, "rule-create");
    expect(first.is_test).toBe(true);
    expect((await saveFinancialRule(deps, chairman, null, input, "rule-create")).id).toBe(first.id);
    const edited = await saveFinancialRule(deps, chairman, first.id, { ...input, expected_version: first.version, channels: ["bot", "site", "noticeboard"] }, "rule-edit");
    expect(edited.version).toBe(first.version + 1);
    const versions = await db.query<{ definition: { channels: string[] } }>("select definition from financial_rule_version where rule_id=$1 order by version", [first.id]);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.definition.channels).toEqual(["bot", "site"]);
    await expect(saveFinancialRule(deps, chairman, first.id, { ...input, expected_version: first.version }, "stale-rule")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    const otherArea = makeTestActor("administrator", [SEED.building2], { isTest: true });
    await expect(saveFinancialRule(deps, otherArea, first.id, { ...input, expected_version: edited.version }, "foreign-rule")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.query("update staff_assignment set status='revoked' where person_id=$1", [SEED.testExecutorPersonId]);
    await expect(saveFinancialRule(deps, chairman, first.id, { ...input, expected_version: edited.version }, "retired-preparer")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await db.query("insert into staff_assignment(person_id,role) values($1,'tech_admin')", [SEED.testExecutorPersonId]);
    const tech = await actorForPerson(db, SEED.testExecutorPersonId, true);
    expect(await listFinancialRules(deps, tech)).toEqual([]);
    await expect(saveFinancialRule(deps, tech, null, input, "tech-rule")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listFinancialRules(deps, chairman))[0]).toMatchObject({ version: edited.version, can_manage: true,
      prepared_name: "Тест: исполнитель", reviewer_name: "Тест: администратор", publisher_name: "Тест: администратор" });
  }, 600_000);
});
