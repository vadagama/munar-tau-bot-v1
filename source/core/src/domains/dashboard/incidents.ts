import type { Actor } from "../../pdp/types.ts";
import { requireRequestManager } from "../requests/staff-queries.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { dashboardPeriod } from "./period.ts";

/**
 * Аварии за период: созданные и завершённые. Видимость как у incident.read для
 * руководителей: область аварий непуста и целиком входит в область актора
 * (председателю — любая непустая область).
 */
export async function dashboardIncidentsAnalytics(deps: RegistryDeps, actor: Actor, period: unknown) {
  requireRequestManager(actor);
  const chairman = actor.assignments.some(a => a.role === "chairman");
  const scope = [...new Set(actor.assignments.filter(a => ["administrator", "deputy"].includes(a.role))
    .flatMap(a => a.scopeBuildingIds ?? []))];
  const range = dashboardPeriod(period);
  const [result] = await deps.db.query<Row>(`with visible as (
      select i.created_at,i.completed_at from incident i
      where i.is_test=$1 and exists(select 1 from incident_scope s where s.incident_id=i.id and s.active)
      and ($2 or not exists(select 1 from incident_scope s where s.incident_id=i.id and s.active
        and not (s.building_id=any($3::uuid[]))))
      and ((i.created_at >= $4::timestamptz and i.created_at < $5::timestamptz)
        or (i.completed_at >= $4::timestamptz and i.completed_at < $5::timestamptz))
    ), buckets as (select * from jsonb_to_recordset($6::text::jsonb) as b(label text,"from" timestamptz,"to" timestamptz))
    select (select jsonb_agg(jsonb_build_object('label',b.label,'from',b."from",'to',b."to",
      'created',(select count(*) from visible v where v.created_at>=b."from" and v.created_at<b."to"),
      'completed',(select count(*) from visible v where v.completed_at>=b."from" and v.completed_at<b."to")) order by b."from") from buckets b) as buckets`,
    [actor.person.isTest, chairman, scope, range.from, range.to, JSON.stringify(range.buckets)]);
  return { ...range, buckets: result?.buckets ?? [] };
}
