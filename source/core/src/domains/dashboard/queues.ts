import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { TASK_SELECT, taskResource, type TaskRow } from "../tasks/access.ts";
import { incidentResource, type IncidentRow } from "../incidents/access.ts";
import type { IncidentScope } from "../incidents/audience.ts";

/** Only active work is read. PDP is applied to every row before totals and preview limits. */
export async function dashboardTasks(deps: RegistryDeps, actor: Actor) {
  const scope = [...new Set(actor.assignments.filter(a => ["administrator", "deputy"].includes(a.role)).flatMap(a => a.scopeBuildingIds ?? []))];
  const rows = await deps.db.query<TaskRow>(`${TASK_SELECT}
    where t.is_test=$1 and t.state in ('created','awaiting_acceptance','on_review')
    and ($2::boolean or r.building_id=any($3::uuid[]) or (cardinality(w.building_ids)>0 and w.building_ids <@ $3::uuid[])
      or (t.assignee_person_id=$4 and $5::boolean)) order by t.created_at desc,t.id`,
    [actor.person.isTest, actor.assignments.some(a => a.role === "chairman"), scope, actor.person.id, actor.assignments.length > 0]);
  return rows.filter(row => can(actor, "task.read", taskResource(row)).allow);
}
export async function dashboardIncidents(deps: RegistryDeps, actor: Actor) {
  // Scope and audience membership are obtained in the same statement, not two round-trips per row.
  const rows = await deps.db.query<IncidentRow & { scope: IncidentScope[]; member: boolean }>(`select i.*,
    coalesce((select jsonb_agg(s order by s.id) from incident_scope s where s.incident_id=i.id and s.active),'[]'::jsonb) as scope,
    exists(select 1 from connection c join premises p on p.id=c.premises_id
      where c.person_id=$2 and c.status='active' and p.is_test=$1 and exists(
        select 1 from incident_scope s where s.incident_id=i.id and s.active and s.building_id=p.building_id
        and (cardinality(s.premises_ids)=0 or p.id=any(s.premises_ids)))) as member
    from incident i where i.is_test=$1 and i.state in ('signal_check','confirmed','mitigation','recovery_check')
    order by i.created_at desc,i.id`, [actor.person.isTest, actor.person.id]);
  return rows.filter(row => can(actor, "incident.read", incidentResource(row, row.scope, row.member)).allow);
}
