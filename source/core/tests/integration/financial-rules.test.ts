import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { saveFinancialRule, listFinancialRules } from "../../src/domains/publications/financial-rules.ts";
import { makeTestActor } from "../../src/testing/actors.ts";

describeWithDb("FIN-04: версионный регламент", getDb => {
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
    expect((await listFinancialRules(deps, chairman))[0]!.version).toBe(edited.version);
  }, 600_000);
});
