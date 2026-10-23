import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { kpiPeriod } from "./contracts.ts";
/** Глобальные KPI — только председателю, вне тестового набора; без имён/связей в DTO. */
export async function kpiSnapshot(exec:DbExecutor,actor:Actor,asOf:string){
 if(actor.person.isTest||!actor.assignments.some(a=>a.role==="chairman"))return {available:false,reason:actor.person.isTest?"TEST_SET":"NOT_IN_ROLE"};
 const [launch]=await exec.query<{id:string;launched_on:string;achieved_at:string|null;people_count:number|null}>(`select l.id,l.launched_on::text,a.achieved_at::text,a.people_count from report_launch l
  left join report_kpi_achievement a on a.launch_id=l.id and a.achieved_at<$1::timestamptz
  where l.created_at<$1::timestamptz order by l.created_at desc,l.id desc limit 1`,[asOf]);
 if(!launch)return {available:true,configured:false};
 const period=kpiPeriod(launch.launched_on)!;
 const [people]=await exec.query<{n:number}>(`with latest as (
  select distinct on(connection_id) * from audience_connection_event where effective_at<$1::timestamptz order by connection_id,effective_at desc,id desc
 ) select count(distinct person_id)::int as n from latest where enabled and not is_test
  and (valid_from is null or valid_from<$1::timestamptz) and (valid_until is null or valid_until>=$1::timestamptz)`,[asOf]);
 const [requests]=await exec.query<{n:number;unknown:number}>(`with eligible as (
  select r.id,observed.to_state,closed.at,closed.close_method from request r
  left join lateral(select e.to_state from report_request_event e
    where e.request_id=r.id and e.kind='state' and e.at<$1::timestamptz order by e.at desc,e.id desc limit 1) observed on true
  left join lateral(select e.at,e.close_method from report_request_event e
    where e.request_id=r.id and e.kind='state' and e.to_state='closed' and e.from_state is distinct from 'closed'
    and e.at<$1::timestamptz order by e.at desc,e.id desc limit 1) closed on true
  where not r.is_test and r.created_at>=$2::timestamptz and r.created_at<$3::timestamptz and r.created_at<$1::timestamptz
   and r.open_at>=$2::timestamptz and r.open_at<$3::timestamptz and r.open_at<$1::timestamptz
   and r.complaint_subject_person_id is distinct from $4::uuid
 ) select count(*) filter(where to_state='closed' and close_method='author' and at>=$2::timestamptz and at<$3::timestamptz)::int as n,
  count(*) filter(where to_state is null or (to_state='closed' and at is null))::int as unknown from eligible`,[asOf,period.from,period.to,actor.person.id]);
 return {available:true,configured:true,launch_id:launch.id,launched_on:launch.launched_on,period,
  kpi_01:{target:100,people:people?.n??0,achieved_at:launch.achieved_at,achieved_count:launch.people_count},
  kpi_02:{target:30,requests:requests?.n??0,unknown:requests?.unknown??0}};
}
