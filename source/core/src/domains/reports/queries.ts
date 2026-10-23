import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { Row } from "../registry/validation.ts";
import { initiativeUuid } from "../initiatives/input.ts";
export type ReportKind="requests"|"tasks"|"incidents"|"payments";
export interface ReportScope {building_ids:string[];selected_building_ids:string[]|null;include_addressless:boolean;own_only:boolean;assignee_id:string|null;is_test:boolean;buildings:{id:string;label:string}[]}
export function reportManager(actor:Actor){return actor.assignments.some(a=>["chairman","administrator","deputy"].includes(a.role));}
export function requestReportAccess(actor:Actor,row:Row){return can(actor,"request.manage",{requestAccess:{authorId:"",buildingId:row.building_id as string|null,state:String(row.state),isTest:row.is_test===true,participant:false,activeAuthor:false,complaintSubjectId:row.complaint_subject_person_id as string|null,chairmanOnly:row.complaint_route==="chairman"}}).allow;}
export async function reportScope(exec:DbExecutor,actor:Actor,kind:ReportKind,input:Row):Promise<ReportScope>{
 if(!can(actor,`report.${kind}`).allow)throw new ApiError("FORBIDDEN");
 const selected=input.building_ids===undefined?null:input.building_ids;
 if(selected!==null&&(!Array.isArray(selected)||!selected.length||selected.length>100))throw new ApiError("VALIDATION_FAILED","Выберите от 1 до 100 домов");
 const ids=selected===null?null:[...new Set((selected as unknown[]).map(id=>initiativeUuid(id,"дом")))];
 const buildings=await exec.query<{id:string;label:string}>("select id,coalesce(name,'Дом '||code) as label from building order by code");
 const chairman=actor.assignments.some(a=>a.role==="chairman"),roles=kind==="payments"?["administrator","deputy","finance"]:kind==="incidents"?["administrator","deputy","duty"]:["administrator","deputy"];
 const allowed=buildings.map(b=>b.id).filter(id=>chairman||actor.assignments.some(a=>roles.includes(a.role)&&(a.scopeBuildingIds??[]).includes(id)));
 if(ids&&(!ids.every(id=>buildings.some(b=>b.id===id))||(kind!=="tasks"&&!ids.every(id=>allowed.includes(id)))))throw new ApiError("FORBIDDEN");
 const assignee=input.assignee_id===undefined?null:initiativeUuid(input.assignee_id,"исполнитель");
 if(assignee&&assignee!==actor.person.id&&!reportManager(actor))throw new ApiError("FORBIDDEN");
 return {building_ids:allowed,selected_building_ids:ids,include_addressless:ids===null&&reportManager(actor),own_only:kind==="tasks"&&!reportManager(actor),assignee_id:assignee,is_test:actor.person.isTest,buildings:buildings.filter(b=>allowed.includes(b.id))};
}
export async function queryRequestReport(exec:DbExecutor,actor:Actor,scope:ReportScope,from:string,asOf:string){
 const chairman=actor.assignments.some(a=>a.role==="chairman");
 return exec.query<Row>(`/* report.requests */ select r.id,r.number,r.kind,r.category_id,(select c.${actor.profile.language==="kk"?"name_kk":"name_ru"} from request_category c where c.id=r.category_id) as category,r.state,r.is_test,r.building_id,r.complaint_subject_person_id,r.complaint_route,
  r.urgency,r.updated_at::text,r.created_at::text,r.first_response_at::text,r.open_at::text,r.closed_at::text,r.close_method,r.confirmation_version,
  coalesce((select jsonb_agg(jsonb_build_object('id',e.id::text,'at',e.at::text,'kind',e.kind,'from_state',e.from_state,'to_state',e.to_state,'action',e.action,'confirmation_version',e.confirmation_version,'close_method',e.close_method) order by e.at,e.id)
   from report_request_event e where e.request_id=r.id and e.at<$5::timestamptz),'[]'::jsonb) as events,
  coalesce((select jsonb_agg(jsonb_build_object('id',timer_event.id::text,'timer_id',timer_event.timer_id,'stage',timer_event.stage,'rule_version_id',timer_event.rule_version_id,'params',timer_event.params,'state',timer_event.state,'due_at',timer_event.due_at::text,'at',timer_event.at::text,'baseline',timer_event.baseline) order by timer_event.at,timer_event.id)
   from report_timer_event timer_event where timer_event.request_id=r.id and timer_event.at<$5::timestamptz),'[]'::jsonb) as timers,
  (select jsonb_build_object('value',rating_event.value,'confirmation_version',rating_event.confirmation_version,'withdrawn_at',v.withdrawn_at::text,'updated_at',rating_event.at::text) from rating_log rating_event left join rating v on v.request_id=rating_event.request_id where rating_event.request_id=r.id and rating_event.at<$5::timestamptz order by rating_event.at desc,rating_event.id desc limit 1) as rating,
  case when queue.unknown=0 then queue.unfinished=0 end as unassigned,queue.overdue>0 as work_overdue,
  exists(select 1 from message m where m.request_id=r.id and m.channel='resident' and m.restricted_at is null and m.created_at<$5::timestamptz and m.author_person_id<>$2 and (m.author_person_id=r.author_person_id or exists(select 1 from request_participant p where p.request_id=r.id and p.person_id=m.author_person_id and p.role='participant')) and not exists(select 1 from request_message_read rd where rd.message_id=m.id and rd.person_id=$2 and rd.read_at<$5::timestamptz)) as unread,
  case when queue.unknown=0 then queue.review>0 end as report_pending
  from request r left join lateral(
   select count(*) filter(where state is null) as unknown,count(*) filter(where state<>'canceled') as unfinished,count(*) filter(where state='on_review') as review,
    count(*) filter(where state not in ('accepted_admin','canceled') and deadline<$5::timestamptz) as overdue from (
    select coalesce(l.to_state,case when t.updated_at<$5::timestamptz then t.state end) as state,
     case when coalesce(l.to_state,t.state)='awaiting_acceptance' then
       case when l.meta ? 'report' then (l.meta->'report'->>'acceptance_due_at')::timestamptz when t.updated_at<$5::timestamptz then t.acceptance_due_at end
      when coalesce(l.to_state,t.state)='rework' then
       case when l.meta ? 'report' then (l.meta->'report'->>'rework_due_at')::timestamptz when t.updated_at<$5::timestamptz then t.rework_due_at end
      else t.due_at end as deadline
    from task t left join lateral(select l.* from task_log l where l.task_id=t.id and l.at<$5::timestamptz order by l.at desc,l.id desc limit 1) l on true
    where t.request_id=r.id and t.created_at<$5::timestamptz
   ) observed_tasks
  ) queue on true where r.is_test=$1 and r.state<>'draft' and r.created_at<$5::timestamptz and (r.open_at is null or r.open_at<$5::timestamptz)
  and r.complaint_subject_person_id is distinct from $2::uuid and ($3 or (r.complaint_route<>'chairman' and (r.building_id=any($4::uuid[]) or ($7 and r.building_id is null))))
  and ($6::uuid[] is null or r.building_id=any($6::uuid[]))
  and (r.open_at>=$8::timestamptz or r.closed_at>=$8::timestamptz or r.state not in ('closed','canceled','rejected')
   or exists(select 1 from report_request_event e where e.request_id=r.id and e.at>=$8::timestamptz and e.kind='state'))
  and ($9::uuid is null or exists(select 1 from task t
   left join lateral(select l.meta from task_log l where l.task_id=t.id and l.at<$5::timestamptz order by l.at desc,l.id desc limit 1) assignment_snapshot on true
   left join lateral(select l.meta from task_log l where l.task_id=t.id and l.at>=$5::timestamptz and l.meta ? 'previous_assignee_id' order by l.at,l.id limit 1) f on true
   where t.request_id=r.id and t.created_at<$5::timestamptz and
   (case when assignment_snapshot.meta->'report' ? 'assignee_person_id' then (assignment_snapshot.meta->'report'->>'assignee_person_id')::uuid
    when assignment_snapshot.meta ? 'assignee_person_id' then (assignment_snapshot.meta->>'assignee_person_id')::uuid
    when f.meta ? 'previous_assignee_id' then (f.meta->>'previous_assignee_id')::uuid
    when t.updated_at<$5::timestamptz then t.assignee_person_id end)=$9))
  order by r.created_at,r.id limit 10001`,[scope.is_test,actor.person.id,chairman,scope.building_ids,asOf,scope.selected_building_ids,scope.include_addressless,from,scope.assignee_id]);
}
export async function queryTaskReport(exec:DbExecutor,actor:Actor,scope:ReportScope,asOf:string,from:string,to:string){
 const scopes=actor.assignments.filter(a=>["administrator","deputy"].includes(a.role)).map(a=>a.scopeBuildingIds??[]),chairman=actor.assignments.some(a=>a.role==="chairman");
 return exec.query<Row>(`/* report.tasks */ with scoped as (
  select t.id,t.number,t.title,t.state,t.is_test,t.assignee_person_id,t.created_at::text,
  coalesce(p.to_state,case when t.updated_at<$4::timestamptz then t.state end) as observed_state,
  case when p.meta->'report' ? 'assignee_person_id' then (p.meta->'report'->>'assignee_person_id')::uuid
   when p.meta ? 'assignee_person_id' then (p.meta->>'assignee_person_id')::uuid
   when f.meta ? 'previous_assignee_id' then (f.meta->>'previous_assignee_id')::uuid
   when t.updated_at<$4::timestamptz then t.assignee_person_id end as observed_assignee_person_id,
  (p.meta->'report' ? 'assignee_person_id' or p.meta ? 'assignee_person_id' or f.meta ? 'previous_assignee_id' or t.updated_at<$4::timestamptz) as assignee_known,
  coalesce(p.meta->'report'->>'due_at',t.due_at::text) as due_at,
  case when p.meta ? 'report' then p.meta->'report'->>'acceptance_due_at' when t.updated_at<$4::timestamptz then t.acceptance_due_at::text end as acceptance_due_at,
  case when p.meta ? 'report' then p.meta->'report'->>'rework_due_at' when t.updated_at<$4::timestamptz then t.rework_due_at::text end as rework_due_at,
  (p.meta ? 'report' or t.updated_at<$4::timestamptz) as deadline_known,
  case when t.request_id is not null then array_remove(array[r.building_id],null) else w.building_ids end as building_ids,
  (select max(l.at)::text from task_log l where l.task_id=t.id and l.to_state='accepted_admin' and l.from_state is distinct from 'accepted_admin' and l.at<$4::timestamptz) as accepted_at,
  (select count(*)::int from visit v where v.task_id=t.id and v.interval_start>=$8::timestamptz and v.interval_start<$9::timestamptz and v.interval_start<$4::timestamptz) as visits,
  (select count(*)::int from task_log l where l.task_id=t.id and l.to_state='rework' and l.at>=$8::timestamptz and l.at<$9::timestamptz and l.at<$4::timestamptz) as reworks
  from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id
  left join lateral(select l.* from task_log l where l.task_id=t.id and l.at<$4::timestamptz order by l.at desc,l.id desc limit 1) p on true
  left join lateral(select l.meta from task_log l where l.task_id=t.id and l.at>=$4::timestamptz and l.meta ? 'previous_assignee_id' order by l.at,l.id limit 1) f on true
  where t.is_test=$1 and t.created_at<$4::timestamptz
 ) select s.*,person.full_name as assignee_name from scoped s left join person on person.id=s.observed_assignee_person_id
 where ((s.assignee_person_id=$2 and s.observed_assignee_person_id=$2) or $3 or (cardinality(s.building_ids)>0 and exists(select 1 from jsonb_array_elements($5::text::jsonb) a where s.building_ids<@array(select jsonb_array_elements_text(a))::uuid[])))
 and ($6::uuid[] is null or s.building_ids && $6::uuid[]) and ($7::uuid is null or s.observed_assignee_person_id=$7)
 order by s.created_at,s.id limit 10001`,[scope.is_test,actor.person.id,chairman,asOf,JSON.stringify(scopes),scope.selected_building_ids,scope.assignee_id,from,to]);
}
export async function queryIncidentReport(exec:DbExecutor,actor:Actor,scope:ReportScope,asOf:string){
 const assignments=actor.assignments.filter(a=>["administrator","deputy","duty"].includes(a.role)).map(a=>({role:a.role,ids:a.scopeBuildingIds??[]}));
 return exec.query<Row>(`/* report.incidents */ with scoped as (
  select i.id,i.number,i.title,i.state,i.is_test,i.responsible_person_id,i.first_signal_at::text,
  case when p.meta ? 'report' then p.meta->'report'->>'completed_at' when (p.meta->>'version')::integer=i.version then i.completed_at::text end as completed_at,
  case when p.meta ? 'report' then p.meta->'report'->>'next_update_at' when (p.meta->>'version')::integer=i.version then i.next_update_at::text end as next_update_at,
  (p.meta ? 'report' or (p.meta->>'version')::integer=i.version) as deadline_known,p.to_state as observed_state,p.at::text as observed_at,
  array(select distinct s.building_id from incident_scope s where s.incident_id=i.id and s.active) as building_ids
  from incident i left join lateral(select l.* from incident_log l where l.incident_id=i.id and l.at<$4::timestamptz order by l.at desc,l.id desc limit 1) p on true
  where i.is_test=$1 and i.created_at<$4::timestamptz
 ) select * from scoped s where ($3 or (cardinality(s.building_ids)>0 and exists(select 1 from jsonb_to_recordset($5::text::jsonb) as a(role text,ids uuid[]) where s.building_ids<@a.ids and (a.role<>'duty' or s.responsible_person_id=$2))))
 and ($6::uuid[] is null or s.building_ids && $6::uuid[]) and ($7::uuid is null or s.responsible_person_id=$7) order by s.first_signal_at,s.id limit 10001`,[scope.is_test,actor.person.id,actor.assignments.some(a=>a.role==="chairman"),asOf,JSON.stringify(assignments),scope.selected_building_ids,scope.assignee_id]);
}
