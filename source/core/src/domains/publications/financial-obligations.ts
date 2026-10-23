import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { ruleDeadline } from "../registry/time.ts";
import { financialPeriodInput, financialRuleInput, type FinancialRule } from "./financial.ts";
import { financialScope, financialPeople, requireFinancialRule } from "./financial-rules.ts";
import { financialPeriodStart } from "./obligation-policy.ts";

export interface FinancialObligation extends Row {
  id: string; version: number; building_ids: string[]; is_test: boolean;
  prepared_by: string; reviewer_id: string; publisher_id: string;
  due_at: string; rule_snapshot: unknown; time_rule_version_id: string;
  publication_id: string | null; completed_at: string | null;
}
export async function requireFinancialObligation(exec: DbExecutor, actor: Actor, id: string, manage = false, lock = false) {
  const [row] = await exec.query<FinancialObligation>(`select *,to_char(period_from,'YYYY-MM-DD') as period_from,to_char(period_to,'YYYY-MM-DD') as period_to from financial_obligation where id=$1${lock ? " for update" : ""}`, [id]);
  if (!row) throw new ApiError("NOT_FOUND");
  if (!financialScope(actor, row.building_ids, row.is_test, manage)) throw new ApiError(manage ? "FORBIDDEN" : "NOT_FOUND");
  return row;
}
export async function createFinancialObligation(deps: RegistryDeps, actor: Actor, input: Row, key: unknown) {
  const period = financialPeriodInput(input), reason = content(input.reason, "причину создания обязанности");
  const ruleId = content(input.rule_id).toLowerCase();
  return deps.db.transaction(exec => idempotent(exec, actor, "financial.obligation.create", key, input, async () => {
    const rule = await requireFinancialRule(exec, actor, ruleId, true, true);
    checkVersion(rule.version, input.expected_version);
    if (!rule.active) invalid("Регламент отключён");
    const [version] = await exec.query<{ id: string; definition: unknown }>("select id,definition from financial_rule_version where rule_id=$1 and version=$2", [rule.id, rule.version]);
    if (!version) invalid("Не найдена действующая версия регламента");
    const definition = financialRuleInput(jsonValue<Row>(version.definition));
    await financialPeople(exec, actor.person.isTest, definition);
    const timingKey = definition.form === "monthly" ? "financial_monthly_publication" : "financial_annual_publication";
    const start = financialPeriodStart(period.period_to), deadline = await ruleDeadline(exec, timingKey, start);
    const [timing] = await exec.query<{ params: unknown }>("select params from time_rule_version where id=$1", [deadline.id]);
    const snapshot = { definition, timing: { key: timingKey, params: jsonValue(timing!.params) }, starts_at: start.toISOString() };
    const [row] = await exec.query<FinancialObligation>(`insert into financial_obligation(financial_rule_version_id,period_from,period_to,building_ids,prepared_by,reviewer_id,publisher_id,time_rule_version_id,rule_snapshot,due_at,is_test,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$10,$11,$12) returning *`,
      [version.id, period.period_from, period.period_to, definition.building_ids, definition.prepared_by, definition.reviewer_id, definition.publisher_id, deadline.id, JSON.stringify(snapshot), deadline.due.toISOString(), actor.person.isTest, actor.person.id]);
    await recordAudit(deps, exec, actor, "financial.obligation.create", "financial_obligation", row!.id, definition.building_ids, null,
      { financial_rule_version_id: version.id, time_rule_version_id: deadline.id, due_at: row!.due_at, ...period }, reason);
    return row!;
  }, row => requireFinancialObligation(exec, actor, row.id, true)));
}
export async function reassignFinancialObligation(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  const reason = content(input.reason, "причину передачи");
  return deps.db.transaction(exec => idempotent(exec, actor, `financial.obligation.reassign:${id}`, key, input, async () => {
    const row = await requireFinancialObligation(exec, actor, id, true, true);
    checkVersion(row.version, input.expected_version);
    if (row.completed_at) throw new ApiError("INVALID_TRANSITION");
    const snapshot = jsonValue<{ definition: FinancialRule }>(row.rule_snapshot);
    const definition = financialRuleInput({ ...snapshot.definition, prepared_by: input.prepared_by, reviewer_id: input.reviewer_id, publisher_id: input.publisher_id });
    await financialPeople(exec, row.is_test, definition);
    const [updated] = await exec.query<FinancialObligation>("update financial_obligation set prepared_by=$2,reviewer_id=$3,publisher_id=$4,reminded_at=null,escalated_at=null,version=version+1 where id=$1 returning *", [id, definition.prepared_by, definition.reviewer_id, definition.publisher_id]);
    await recordAudit(deps, exec, actor, "financial.obligation.reassign", "financial_obligation", id, row.building_ids,
      { prepared_by: row.prepared_by, reviewer_id: row.reviewer_id, publisher_id: row.publisher_id },
      { prepared_by: definition.prepared_by, reviewer_id: definition.reviewer_id, publisher_id: definition.publisher_id }, reason);
    return updated!;
  }, () => requireFinancialObligation(exec, actor, id, true)));
}
