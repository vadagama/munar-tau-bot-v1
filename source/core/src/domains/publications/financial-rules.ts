import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { actorForPerson } from "../documents/service.ts";
import { buildingInput } from "../tasks/common.ts";
import { financialRuleInput, type FinancialRule } from "./financial.ts";

export interface FinancialRuleRow extends Row {
  id: string; version: number; name: string; definition: FinancialRule; active: boolean; is_test: boolean;
}
/** Административное чтение регламента не открывается через личную собственность. */
export function financialScope(actor: Actor, buildingIds: string[], isTest: boolean, manage = false) {
  return can(actor, manage ? "publication.manage" : "publication.read", {
    publicationAccess: { buildingIds, isTest, financial: true, published: false, member: false, owner: false },
  }).allow;
}
export async function requireFinancialRule(exec: DbExecutor, actor: Actor, id: string, manage = false, lock = false) {
  const [row] = await exec.query<FinancialRuleRow>(`select * from financial_rule where id=$1${lock ? " for update" : ""}`, [id]);
  if (!row) throw new ApiError("NOT_FOUND");
  row.definition = jsonValue<FinancialRule>(row.definition);
  if (!financialScope(actor, row.definition.building_ids ?? [], row.is_test, manage)) throw new ApiError(manage ? "FORBIDDEN" : "NOT_FOUND");
  return row;
}
/** Ответственные проверяются тем же PDP, что будет применён к финансовому документу. */
export async function financialPeople(exec: DbExecutor, isTest: boolean, rule: FinancialRule) {
  const actors = new Map<string, Actor>();
  for (const id of new Set([rule.prepared_by, rule.reviewer_id, rule.publisher_id])) actors.set(id, await actorForPerson(exec, id, isTest));
  const resource = { documentAccess: { buildingIds: rule.building_ids, isTest, financial: true, audience: "owner" as const,
    published: false, member: false, owner: false, sourceAllowed: true, sourceManageable: true,
    preparedById: rule.prepared_by, reviewerId: rule.reviewer_id, assignedTask: false, resultAuthorIds: [] } };
  for (const [id, action] of [[rule.prepared_by, "document.prepare"], [rule.reviewer_id, "document.review"]] as const) {
    if (!can(actors.get(id)!, action, resource).allow) invalid("Подготовитель или проверяющий не имеет полномочий на финансовый документ");
  }
  if (!financialScope(actors.get(rule.publisher_id)!, rule.building_ids, isTest, true)) invalid("Выберите действующего публикатора с полномочиями на все дома отчёта");
}
export async function saveFinancialRule(deps: RegistryDeps, actor: Actor, id: string | null, input: Row, key: unknown) {
  id = id?.toLowerCase() ?? null;
  const data = financialRuleInput(input), reason = content(input.reason, "причину настройки");
  if (input.active !== undefined && typeof input.active !== "boolean") invalid("Укажите действующий или отключённый регламент");
  return deps.db.transaction(exec => idempotent(exec, actor, `financial.rule.save:${id ?? "new"}`, key, input, async () => {
    const old = id ? await requireFinancialRule(exec, actor, id, true, true) : null;
    if (old) checkVersion(old.version, input.expected_version);
    await buildingInput(exec, actor, data.building_ids);
    if (!financialScope(actor, data.building_ids, actor.person.isTest, true)) throw new ApiError("FORBIDDEN");
    await financialPeople(exec, actor.person.isTest, data);
    const active = input.active ?? old?.active ?? true;
    const [row] = old
      ? await exec.query<FinancialRuleRow>("update financial_rule set name=$2,definition=$3::text::jsonb,active=$4,version=version+1 where id=$1 returning *", [id, data.name, JSON.stringify(data), active])
      : await exec.query<FinancialRuleRow>("insert into financial_rule(name,definition,active,is_test,created_by) values($1,$2::text::jsonb,$3,$4,$5) returning *", [data.name, JSON.stringify(data), active, actor.person.isTest, actor.person.id]);
    await exec.query("insert into financial_rule_version(rule_id,version,definition,reason,created_by) values($1,$2,$3::text::jsonb,$4,$5)", [row!.id, row!.version, JSON.stringify(data), reason, actor.person.id]);
    await recordAudit(deps, exec, actor, "financial.rule.save", "financial_rule", row!.id, data.building_ids,
      old ? { version: old.version } : null, { version: row!.version, form: data.form, active }, reason);
    return { ...row!, definition: data };
  }, row => requireFinancialRule(exec, actor, row.id, true)));
}
export async function listFinancialRules(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<FinancialRuleRow>(`select f.*,p.full_name as prepared_name,r.full_name as reviewer_name,u.full_name as publisher_name
    from financial_rule f left join person p on p.id::text=f.definition->>'prepared_by' and p.is_test=f.is_test
    left join person r on r.id::text=f.definition->>'reviewer_id' and r.is_test=f.is_test
    left join person u on u.id::text=f.definition->>'publisher_id' and u.is_test=f.is_test
    where f.is_test=$1 order by f.created_at desc,f.id`, [actor.person.isTest]);
  return rows.map(row => ({ ...row, definition: jsonValue<FinancialRule>(row.definition) }))
    .filter(row => financialScope(actor, row.definition.building_ids ?? [], row.is_test))
    .map(row => ({ ...row, can_manage: financialScope(actor, row.definition.building_ids, row.is_test, true) }));
}
