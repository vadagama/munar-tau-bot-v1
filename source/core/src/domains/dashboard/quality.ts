import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { MANAGER_REQUEST_SCOPE, managerRequestParams } from "../requests/staff-queries.ts";
import { dashboardPeriod } from "./period.ts";

/**
 * Качество исполнения за период: длительность закрытия обращений (медиана),
 * просрочки (обращения, закрытые позже срока; задания, принятые позже срока)
 * и оценки жителей. Агрегация в PostgreSQL, тексты не покидают базу.
 */
export async function dashboardQualityAnalytics(deps: RegistryDeps, actor: Actor, period: unknown) {
  const params = managerRequestParams(actor);
  const range = dashboardPeriod(period);
  const [result] = await deps.db.query<Row>(`with closed as (
      select r.created_at,r.closed_at,(r.closed_at>r.due_at) as late
      from request r where ${MANAGER_REQUEST_SCOPE}
      and r.closed_at >= $6::timestamptz and r.closed_at < $7::timestamptz
    ), visible as (
      select t.due_at,
        (select max(l.at) from task_log l where l.task_id=t.id and l.to_state='accepted_admin'
          and l.from_state is distinct from 'accepted_admin') as accepted_at
      from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id
      where t.is_test=$1 and ($3 or r.building_id=any($5::uuid[])
        or (cardinality(w.building_ids)>0 and w.building_ids <@ $5::uuid[]))
      and exists(select 1 from task_log l where l.task_id=t.id and l.to_state='accepted_admin'
        and l.from_state is distinct from 'accepted_admin' and l.at >= $6::timestamptz and l.at < $7::timestamptz)
    ), rated as (
      select g.created_at,g.value from rating g join request r on r.id=g.request_id
      where ${MANAGER_REQUEST_SCOPE} and g.withdrawn_at is null
      and g.created_at >= $6::timestamptz and g.created_at < $7::timestamptz
    ), buckets as (select * from jsonb_to_recordset($8::text::jsonb) as b(label text,"from" timestamptz,"to" timestamptz))
    select (select jsonb_agg(jsonb_build_object('label',b.label,'from',b."from",'to',b."to",
      'requests_late',(select count(*) from closed c where c.closed_at>=b."from" and c.closed_at<b."to" and c.late),
      'accepted_late',(select count(*) from visible v where v.accepted_at>=b."from" and v.accepted_at<b."to" and v.accepted_at>v.due_at),
      'median_hours',(select percentile_cont(0.5) within group (order by extract(epoch from (c.closed_at-c.created_at)))/3600
        from closed c where c.closed_at>=b."from" and c.closed_at<b."to"),
      'avg_rating',(select avg(g.value) from rated g where g.created_at>=b."from" and g.created_at<b."to"),
      'rated',(select count(*) from rated g where g.created_at>=b."from" and g.created_at<b."to")) order by b."from") from buckets b) as buckets`,
    [...params, range.from, range.to, JSON.stringify(range.buckets)]);
  return { ...range, buckets: result?.buckets ?? [] };
}
