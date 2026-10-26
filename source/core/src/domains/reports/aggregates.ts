// Агрегаты отчётного домена для виджетов и инструментов AI-ассистента (S4a.1).
// Read-only по существующим правам report.*; область PDP собирается reportScope
// до агрегации, SQL-предикаты повторяют queryRequestReport/queryTaskReport
// (REP-01/02/03: фильтрация до группировки, исторические снимки — из логов).
// lockAudience не вызывается: аудитории-истории эти запросы не читают и данных
// не меняют (как dashboardAnalytics). Контракты — компактные серии/таблицы.

import { CURRENT_OVERDUE } from "../requests/staff-queries.ts";
import { invalid,type Row } from "../registry/validation.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { REPORT_ZONE,dateParts,zonedInstant } from "./calendar.ts";
import { reportScope } from "./queries.ts";

const MAX_RANGE_DAYS=92,WORKLOAD_LIMIT=50,OVERDUE_LIMIT=100;

/** CURRENT_OVERDUE (очередь/дашборд) с границей времени-параметром вместо now(). */
const overdueAt=(param:string)=>CURRENT_OVERDUE.replaceAll("now()",param);

async function clockAt(exec:DbExecutor):Promise<string> {
 const [row]=await exec.query<{at:string}>("select clock_timestamp()::text as at");
 if(!row)throw new Error("Серверное время недоступно");
 return row.at;
}

/** Дата YYYY-MM-DD в Алматы — для бакета «сегодня» без периода. */
function almatyDate(at:string):string {
 return new Intl.DateTimeFormat("en-CA",{timeZone:REPORT_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));
}

function nextDay(date:string):string {
 const {year,month,day}=dateParts(date);
 return new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
}

function instant(date:string):string {return new Date(zonedInstant(date,5)).toISOString();}

/**
 * Фильтры агрегата: допускаются только переданные ключи (повторная проверка
 * поверх reportScope), период — обе даты YYYY-MM-DD или ничего; диапазон
 * ≤ 92 суток с границами 05:00 Алматы.
 */
function aggregateInput(input:Row,keys:string[]):{dates:{from:string;to:string}|null} {
 if(Object.keys(input).some(k=>!keys.includes(k)))invalid("Неизвестные фильтры отчёта");
 const from=input.from,to=input.to;
 if(from===undefined&&to===undefined)return {dates:null};
 if(typeof from!=="string"||typeof to!=="string")invalid("Укажите обе границы периода отчёта");
 dateParts(from);dateParts(to);
 const start=zonedInstant(from,5),end=zonedInstant(nextDay(to),5);
 if(start>=end)invalid("Некорректный период отчёта");
 if(end-start>MAX_RANGE_DAYS*86_400_000)invalid("Период отчёта больше 92 дней");
 return {dates:{from,to}};
}

function dayBuckets(from:string,to:string):Row[] {
 const buckets:Row[]=[];let cursor=from;
 for(;;){
  const end=nextDay(cursor);
  buckets.push({day:cursor,from:instant(cursor),to:instant(end)});
  if(end>to)break;
  cursor=end;
 }
 return buckets;
}

const number=(value:unknown)=>Number(value??0);
const text=(value:unknown)=>value===null||value===undefined?null:String(value);

/** Нагрузка сотрудников: открытые/просроченные/на проверке/на доработке задания по исполнителям. */
export async function workloadByAssignee(deps:RegistryDeps,actor:Actor,input:Row):Promise<Row> {
 const {dates}=aggregateInput(input,["from","to","building_ids","assignee_id"]);
 const scope=await reportScope(deps.db,actor,"tasks",input);
 const asOf=await clockAt(deps.db);
 const chairman=actor.assignments.some(a=>a.role==="chairman");
 const scopes=actor.assignments.filter(a=>["administrator","deputy"].includes(a.role)).map(a=>a.scopeBuildingIds??[]);
 const source=await deps.db.query<Row>(`/* report.tasks */ with scoped as (
  select t.id,t.assignee_person_id,
   coalesce(p.to_state,case when t.updated_at<$4::timestamptz then t.state end) as observed_state,
   case when p.meta->'report' ? 'assignee_person_id' then (p.meta->'report'->>'assignee_person_id')::uuid
    when p.meta ? 'assignee_person_id' then (p.meta->>'assignee_person_id')::uuid
    when f.meta ? 'previous_assignee_id' then (f.meta->>'previous_assignee_id')::uuid
    when t.updated_at<$4::timestamptz then t.assignee_person_id end as observed_assignee_person_id,
   coalesce(p.meta->'report'->>'due_at',t.due_at::text) as due_at,
   case when p.meta ? 'report' then p.meta->'report'->>'acceptance_due_at' when t.updated_at<$4::timestamptz then t.acceptance_due_at::text end as acceptance_due_at,
   case when p.meta ? 'report' then p.meta->'report'->>'rework_due_at' when t.updated_at<$4::timestamptz then t.rework_due_at::text end as rework_due_at,
   case when t.request_id is not null then array_remove(array[r.building_id],null) else w.building_ids end as building_ids
  from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id
  left join lateral(select l.* from task_log l where l.task_id=t.id and l.at<$4::timestamptz order by l.at desc,l.id desc limit 1) p on true
  left join lateral(select l.meta from task_log l where l.task_id=t.id and l.at>=$4::timestamptz and l.meta ? 'previous_assignee_id' order by l.at,l.id limit 1) f on true
  where t.is_test=$1 and t.created_at<$4::timestamptz
   and ($8::timestamptz is null or t.created_at>=$8::timestamptz) and ($9::timestamptz is null or t.created_at<$9::timestamptz)
 ), by_assignee as (
  select s.observed_assignee_person_id as person_id,person.full_name as name,
   count(*) filter(where s.observed_state is not null and s.observed_state not in ('accepted_admin','canceled')) as open,
   count(*) filter(where s.observed_state is not null and s.observed_state not in ('accepted_admin','canceled')
    and (case when s.observed_state='awaiting_acceptance' then s.acceptance_due_at when s.observed_state='rework' then s.rework_due_at else s.due_at end)::timestamptz<$4::timestamptz) as overdue,
   count(*) filter(where s.observed_state='on_review') as on_review,
   count(*) filter(where s.observed_state='rework') as rework
  from scoped s left join person on person.id=s.observed_assignee_person_id
  where ((s.assignee_person_id=$2 and s.observed_assignee_person_id=$2) or $3 or (cardinality(s.building_ids)>0 and exists(select 1 from jsonb_array_elements($5::text::jsonb) a where s.building_ids<@array(select jsonb_array_elements_text(a))::uuid[])))
   and ($6::uuid[] is null or s.building_ids && $6::uuid[]) and ($7::uuid is null or s.observed_assignee_person_id=$7)
  group by s.observed_assignee_person_id,person.full_name
 ) select person_id,name,open,overdue,on_review,rework,sum(open) over() as total_open from by_assignee
  order by overdue desc,open desc,name asc nulls last,person_id asc nulls last limit ${WORKLOAD_LIMIT+1}`,
 [scope.is_test,actor.person.id,chairman,asOf,JSON.stringify(scopes),scope.selected_building_ids,scope.assignee_id,dates?instant(dates.from):null,dates?instant(nextDay(dates.to)):null]);
 return {kind:"workload_by_assignee",as_of:asOf,period:dates?{...dates,timezone:REPORT_ZONE}:null,
  rows:source.slice(0,WORKLOAD_LIMIT).map(r=>({person_id:text(r.person_id),name:text(r.name),open:number(r.open),overdue:number(r.overdue),on_review:number(r.on_review),rework:number(r.rework)})),
  total:number(source[0]?.total_open),truncated:source.length>WORKLOAD_LIMIT,is_test:actor.person.isTest};
}

/** Создано/закрыто по суткам 05:00→05:00 Алматы; без периода — текущие сутки. */
export async function createdClosedByDay(deps:RegistryDeps,actor:Actor,input:Row):Promise<Row> {
 const {dates}=aggregateInput(input,["from","to","building_ids"]);
 const scope=await reportScope(deps.db,actor,"requests",input);
 const asOf=await clockAt(deps.db);
 const range=dates??{from:almatyDate(asOf),to:almatyDate(asOf)};
 const from=instant(range.from),to=instant(nextDay(range.to));
 const chairman=actor.assignments.some(a=>a.role==="chairman");
 const [row]=await deps.db.query<Row>(`/* report.requests */ with visible as (
  select r.created_at,r.closed_at from request r
  where r.is_test=$1 and r.state<>'draft'
   and r.complaint_subject_person_id is distinct from $2::uuid
   and ($3 or (r.complaint_route<>'chairman' and (r.building_id=any($4::uuid[]) or ($6 and r.building_id is null))))
   and ($5::uuid[] is null or r.building_id=any($5::uuid[]))
   and ((r.created_at>=$7::timestamptz and r.created_at<$8::timestamptz) or (r.closed_at>=$7::timestamptz and r.closed_at<$8::timestamptz))
 ), day_buckets as (select * from jsonb_to_recordset($9::text::jsonb) as b(day text,"from" timestamptz,"to" timestamptz))
 select coalesce((select jsonb_agg(jsonb_build_object('day',b.day,'from',b."from",'to',b."to",
   'created',(select count(*) from visible v where v.created_at>=b."from" and v.created_at<b."to"),
   'closed',(select count(*) from visible v where v.closed_at>=b."from" and v.closed_at<b."to")) order by b."from") from day_buckets b),'[]'::jsonb) as buckets`,
 [scope.is_test,actor.person.id,chairman,scope.building_ids,scope.selected_building_ids,scope.include_addressless,from,to,JSON.stringify(dayBuckets(range.from,range.to))]);
 const buckets=(Array.isArray(row?.buckets)?row.buckets:[]) as Row[];
 return {kind:"created_closed_by_day",as_of:asOf,period:{from,to,timezone:REPORT_ZONE},
  buckets:buckets.map(b=>({day:String(b.day),from:String(b.from),to:String(b.to),created:number(b.created),closed:number(b.closed)})),
  totals:{created:buckets.reduce((sum,b)=>sum+number(b.created),0),closed:buckets.reduce((sum,b)=>sum+number(b.closed),0)},is_test:actor.person.isTest};
}

/** Просрочка по домам: открытые и просроченные обращения, включая безадресную очередь. */
export async function overdueByBuilding(deps:RegistryDeps,actor:Actor,input:Row):Promise<Row> {
 const {dates}=aggregateInput(input,["from","to","building_ids"]);
 const scope=await reportScope(deps.db,actor,"requests",input);
 const asOf=await clockAt(deps.db);
 const chairman=actor.assignments.some(a=>a.role==="chairman");
 const source=await deps.db.query<Row>(`/* report.requests */ with visible as (
  select r.building_id,b.name as building_name,b.code as building_code,
   (r.state not in ('closed','canceled','rejected')) as open,
   (${overdueAt("$5::timestamptz")}) as overdue
  from request r left join building b on b.id=r.building_id
  where r.is_test=$1 and r.state<>'draft'
   and r.complaint_subject_person_id is distinct from $2::uuid
   and ($3 or (r.complaint_route<>'chairman' and (r.building_id=any($4::uuid[]) or ($7 and r.building_id is null))))
   and ($6::uuid[] is null or r.building_id=any($6::uuid[]))
   and ($8::timestamptz is null or r.created_at>=$8::timestamptz) and ($9::timestamptz is null or r.created_at<$9::timestamptz)
 ), by_building as (
  select v.building_id,case when v.building_id is null then null else coalesce(v.building_name,'Дом '||v.building_code) end as label,
   count(*) filter(where v.open) as open,count(*) filter(where v.overdue) as overdue
  from visible v group by v.building_id,v.building_name,v.building_code
 ) select building_id,label,open,overdue,sum(overdue) over() as total_overdue from by_building
  order by overdue desc,open desc,label asc nulls last,building_id asc nulls last limit ${OVERDUE_LIMIT+1}`,
 [scope.is_test,actor.person.id,chairman,scope.building_ids,asOf,scope.selected_building_ids,scope.include_addressless,dates?instant(dates.from):null,dates?instant(nextDay(dates.to)):null]);
 return {kind:"overdue_by_building",as_of:asOf,period:dates?{...dates,timezone:REPORT_ZONE}:null,
  rows:source.slice(0,OVERDUE_LIMIT).map(r=>({building_id:text(r.building_id),label:text(r.label),open:number(r.open),overdue:number(r.overdue)})),
  total:number(source[0]?.total_overdue),truncated:source.length>OVERDUE_LIMIT,is_test:actor.person.isTest};
}
