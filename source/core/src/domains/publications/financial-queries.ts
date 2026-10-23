import type { Actor } from "../../pdp/types.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { financialScope } from "./financial-rules.ts";
import { requireFinancialObligation, type FinancialObligation } from "./financial-obligations.ts";
import { missingFinancialPlacements } from "./obligation-policy.ts";
import type { FinancialRule } from "./financial.ts";

export async function listFinancialObligations(deps: RegistryDeps, actor: Actor, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) invalid("Некорректная страница очереди");
  const rows = await deps.db.query<FinancialObligation>(`select o.id,o.version,o.building_ids,o.is_test,o.prepared_by,o.reviewer_id,o.publisher_id,
    to_char(o.period_from,'YYYY-MM-DD') as period_from,to_char(o.period_to,'YYYY-MM-DD') as period_to,
    o.due_at,o.completed_at,o.publication_id,o.active_version_id,p.full_name as prepared_name,r.full_name as reviewer_name,u.full_name as publisher_name
    from financial_obligation o join person p on p.id=o.prepared_by join person r on r.id=o.reviewer_id join person u on u.id=o.publisher_id
    where o.is_test=$1 order by o.completed_at nulls first,o.due_at,o.id`, [actor.person.isTest]);
  const allowed = rows.filter(row => financialScope(actor, row.building_ids, row.is_test));
  return { items: allowed.slice(offset, offset + 200).map(row => ({ ...row, can_manage: financialScope(actor, row.building_ids, row.is_test, true) })), has_more: allowed.length > offset + 200 };
}
export async function getFinancialObligation(deps: RegistryDeps, actor: Actor, id: string) {
  const row = await requireFinancialObligation(deps.db, actor, id);
  const [placements, publications] = await Promise.all([
    deps.db.query<Row & { financial_version_id: string; channel: string }>("select * from financial_placement where obligation_id=$1 order by created_at,id", [id]),
    deps.db.query<{ financial_version_id: string | null }>("select financial_version_id from publication where id=$1", [row.publication_id]),
  ]);
  const snapshot = jsonValue<{ definition: FinancialRule }>(row.rule_snapshot);
  const current = publications[0]?.financial_version_id === row.active_version_id ? row.active_version_id as string | null : null;
  return { ...row, rule_snapshot: snapshot, placements, can_manage: financialScope(actor, row.building_ids, row.is_test, true),
    missing_channels: current ? missingFinancialPlacements(snapshot.definition.channels, current, placements) : snapshot.definition.channels };
}
