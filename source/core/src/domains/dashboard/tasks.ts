import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { requireRequestManager } from "../requests/staff-queries.ts";
import { TASK_STATES } from "../tasks/fsm.ts";
import { dashboardPeriod } from "./period.ts";

/** Аналитика заданий для главной: скоуп видимости как у списка заданий (listTasks). */
export async function dashboardTasksAnalytics(deps: RegistryDeps, actor: Actor, period: unknown) {
  requireRequestManager(actor);
  const chairman = actor.assignments.some(a => a.role === "chairman");
  const scope = [...new Set(actor.assignments.filter(a => ["administrator", "deputy"].includes(a.role))
    .flatMap(a => a.scopeBuildingIds ?? []))];
  const range = dashboardPeriod(period);
  // Агрегация в PostgreSQL: названия заданий и история не покидают базу.
  const [result] = await deps.db.query<Row>(`with visible as (
      select t.created_at,t.state,
        (select max(l.at) from task_log l where l.task_id=t.id and l.to_state='accepted_admin'
          and l.from_state is distinct from 'accepted_admin') as accepted_at
      from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id
      where t.is_test=$1 and ($2 or r.building_id=any($3::uuid[])
        or (cardinality(w.building_ids)>0 and w.building_ids <@ $3::uuid[]))
      and ((t.created_at >= $4::timestamptz and t.created_at < $5::timestamptz)
        or exists(select 1 from task_log l where l.task_id=t.id and l.to_state='accepted_admin'
          and l.from_state is distinct from 'accepted_admin' and l.at >= $4::timestamptz and l.at < $5::timestamptz))
    ), buckets as (select * from jsonb_to_recordset($6::text::jsonb) as b(label text,"from" timestamptz,"to" timestamptz))
    select (select jsonb_agg(jsonb_build_object('label',b.label,'from',b."from",'to',b."to",
      'created',(select count(*) from visible v where v.created_at>=b."from" and v.created_at<b."to"),
      'accepted',(select count(*) from visible v where v.accepted_at>=b."from" and v.accepted_at<b."to")) order by b."from") from buckets b) as buckets,
      (select jsonb_agg(jsonb_build_object('state',s.state,'count',(select count(*) from visible v
        where v.state=s.state and v.created_at>=$4::timestamptz and v.created_at<$5::timestamptz)))
       from unnest($7::text[]) as s(state)) as states`,
    [actor.person.isTest, chairman, scope, range.from, range.to, JSON.stringify(range.buckets), [...TASK_STATES]]);
  return { ...range, buckets: result?.buckets ?? [], states: result?.states ?? [] };
}

/** Текущая нагрузка: открытые и просроченные задания по исполнителям (снимок, без периода). */
export async function dashboardTasksWorkload(deps: RegistryDeps, actor: Actor) {
  requireRequestManager(actor);
  const chairman = actor.assignments.some(a => a.role === "chairman");
  const scope = [...new Set(actor.assignments.filter(a => ["administrator", "deputy"].includes(a.role))
    .flatMap(a => a.scopeBuildingIds ?? []))];
  const [result] = await deps.db.query<Row>(`with visible as (
      select t.assignee_person_id,t.due_at
      from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id
      where t.is_test=$1 and ($2 or r.building_id=any($3::uuid[])
        or (cardinality(w.building_ids)>0 and w.building_ids <@ $3::uuid[]))
      and t.state not in ('accepted_admin','canceled')
    )
    select coalesce(jsonb_agg(jsonb_build_object('person_id',g.person_id,'name',g.name,'open',g.open,'overdue',g.overdue)
      order by g.open desc,g.overdue desc,g.name),'[]'::jsonb) as workload
    from (select v.assignee_person_id as person_id,coalesce(p.full_name,'Без исполнителя') as name,
      count(*) as open,count(*) filter (where v.due_at<now()) as overdue
      from visible v left join person p on p.id=v.assignee_person_id
      group by v.assignee_person_id,p.full_name) g`,
    [actor.person.isTest, chairman, scope]);
  return { workload: result?.workload ?? [] };
}
