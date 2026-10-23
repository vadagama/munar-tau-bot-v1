import { STATES } from "../requests/fsm.ts";
import { TASK_STATES } from "../tasks/fsm.ts";
import { INCIDENT_STATES } from "../incidents/fsm.ts";
import { listTaskAssignees } from "../tasks/assignees.ts";
import { kpiSnapshot } from "./kpi.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid,type Row } from "../registry/validation.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { reportPeriod,summarizeRequests,type RequestReportFact } from "./contracts.ts";
import { reportInstantUs } from "./calendar.ts";
import { requestCycles,type RequestReportEvent } from "./history.ts";
import { calendarMinutes,workingMinutes,cycleDurations } from "./durations.ts";
import type { RuleParams } from "../registry/time.ts";
import { reportManager,reportScope,requestReportAccess,queryRequestReport,queryTaskReport,queryIncidentReport,type ReportKind,type ReportScope } from "./queries.ts";
const before=(value:unknown,at:string):value is string=>typeof value==="string"&&reportInstantUs(value)<reportInstantUs(at);
const text=(v:unknown)=>typeof v==="string"?v:null;
function array<T>(value:unknown):T[]{if(!Array.isArray(value))throw new Error("Некорректный набор фактов отчёта");return value as T[];}
interface TimerFact {id:string;timer_id:string;stage:string;rule_version_id:string;params:RuleParams;state:string;at:string;due_at:string;baseline:boolean}
export interface ReportReadOptions {asOf?:string;allRows?:boolean}
export function reportInput(input:Row){
 if(Object.keys(input).some(k=>!["from","to","building_ids","assignee_id","state","offset","limit"].includes(k)))invalid("Неизвестные фильтры отчёта");
 if(typeof input.from!=="string"||typeof input.to!=="string")invalid("Укажите период отчёта");
 const period=reportPeriod(input.from,input.to),offset=Number(input.offset??0),limit=Number(input.limit??50);
 if(!Number.isSafeInteger(offset)||offset<0||offset>10000||!Number.isSafeInteger(limit)||limit<1||limit>100)invalid("Некорректная страница отчёта");
 const state=input.state===undefined?null:String(input.state);if(state!==null&&!/^[a-z_]{1,40}$/.test(state))invalid("Некорректное состояние");return {period,offset,limit,state};
}
function sourceBound(rows:Row[]){if(rows.length>10000)invalid("В отчёте больше 10000 объектов. Выберите отдельные дома");return rows;}
export async function operationalReport(deps:RegistryDeps,actor:Actor,kind:ReportKind,input:Row,options:ReportReadOptions={}){
 const filters=reportInput(input);
 if(filters.state!==null&&kind!=="payments"&&!(kind==="requests"?STATES:kind==="tasks"?TASK_STATES:INCIDENT_STATES).some(s=>s===filters.state))invalid("Неизвестное состояние отчёта");
 if(!can(actor,`report.${kind}`).allow)throw new ApiError("FORBIDDEN");
 if(options.allRows&&!can(actor,"report.export").allow)throw new ApiError("FORBIDDEN");
 return deps.db.transaction(async exec=>{
  await lockAudience(exec);const scope=await reportScope(exec,actor,kind,input);
  const [clock]=await exec.query<{at:string}>("select clock_timestamp()::text as at");if(!clock)throw new Error("Серверное время недоступно");
  const asOf=options.asOf??clock.at;if(reportInstantUs(asOf)>reportInstantUs(clock.at))invalid("Граница отчёта ещё не наступила");
  const filterOptions={buildings:scope.buildings,assignees:kind!=="payments"?(!reportManager(actor)?[{id:actor.person.id,name:actor.person.fullName}]:(await listTaskAssignees(exec,scope.is_test,scope.building_ids)).map(p=>({id:p.id,name:p.full_name}))):[]};
  const base={kind,as_of:asOf,period:filters.period,scope,filter_options:filterOptions,is_test:actor.person.isTest};
  if(kind==="payments")return {...base,available:false,reason:"VS6_SOURCE_UNAVAILABLE"};
  if(kind==="requests"){
   const [meta]=await exec.query<{starts_at:string}>("select starts_at::text from report_history_meta where singleton");if(!meta)throw new Error("История отчётности не инициализирована");
   const source=sourceBound(await queryRequestReport(exec,actor,scope,filters.period.from,asOf)).filter(r=>requestReportAccess(actor,r));
   const facts:RequestReportFact[]=[],items:Row[]=[];
   for(const r of source){
    if(r.open_at&&!before(r.open_at,asOf))continue;
    const events=array<RequestReportEvent&{close_method?:string|null}>(r.events),history=requestCycles(events,asOf),registered=history.registered_at??text(r.open_at);
    const state=history.state_at_as_of??(before(r.updated_at,asOf)?text(r.state):null);
    const closed=state==="closed"?(history.final_closed_at??(before(r.closed_at,asOf)?text(r.closed_at):null)):null;
    if(filters.state!==null&&state!==filters.state)continue;
    const close=closed?events.filter(e=>e.to_state==="closed"&&e.from_state!=="closed"&&before(e.at,asOf)).at(-1):null;
    const confirmation=close&&close.confirmation_version>0?close.confirmation_version:before(r.updated_at,asOf)?Number(r.confirmation_version):null,method=closed?(close?.close_method??text(r.close_method)):null;
    const responseKnown=registered!==null&&reportInstantUs(registered)>=reportInstantUs(meta.starts_at);
    const response=responseKnown?events.find(e=>e.kind==="response"&&before(e.at,asOf))?.at??null:null;
    const timers=array<TimerFact>(r.timers),firstTimer=timers.find(t=>t.stage==="request_first_response"&&!t.baseline);
    const work=response&&registered&&firstTimer?workingMinutes(registered,response,firstTimer.params,[{from:registered,to:response}],r.urgency==="critical"):null;
    const latest=new Map<string,TimerFact>();for(const t of timers)latest.set(t.timer_id,t);
    const overdue=r.work_overdue===true||([...latest.values()].some(t=>t.stage==="request_first_response"&&["pending","fired"].includes(t.state)&&before(t.due_at,asOf)&&!response&&!before(r.first_response_at,asOf)));
    const rating=r.rating as Row|null,validRating=closed&&method==="author"&&rating&&Number(rating.confirmation_version)===confirmation&&before(rating.updated_at,asOf)&&(!rating.withdrawn_at||!before(rating.withdrawn_at,asOf));
    facts.push({id:String(r.id),created_at:String(r.created_at),registered_at:registered,final_closed_at:closed,state_at_as_of:state,close_method:method,rating:validRating?Number(rating!.value):null,
     response_history_complete:responseKnown,first_response_at:response,first_response_working_minutes:work,overdue,rework_at:events.filter(e=>["return_result","reopen"].includes(e.action)).map(e=>e.at),is_test:r.is_test===true,is_pilot:false,
     canceled_at:events.filter(e=>e.to_state==="canceled").at(-1)?.at??null,rejected_at:events.filter(e=>e.to_state==="rejected").at(-1)?.at??null});
    const end=closed??asOf;
    items.push({id:r.id,number:r.number,kind:r.kind,category_id:r.category_id,category:r.category??null,state,building_id:r.building_id,registered_at:registered,closed_at:closed,close_method:method,
     calendar_minutes:calendarMinutes(registered,end),first_response_calendar_minutes:calendarMinutes(registered,response),first_response_working_minutes:work,
     cycles:cycleDurations(history.cycles,asOf),history_complete:history.complete,unassigned:r.unassigned===null?null:r.unassigned===true,unread:r.unread===true,report_pending:r.report_pending===null?null:r.report_pending===true,
     working_by_timer:timers.flatMap((t,i)=>{if(t.state!=="pending")return [];const next=timers.slice(i+1).find(n=>n.timer_id===t.timer_id),until=next&&before(next.at,end)?next.at:end;
      return [{purpose:t.stage,rule_version_id:t.rule_version_id,baseline:t.baseline,minutes:t.baseline?null:workingMinutes(t.at,until,t.params,[{from:t.at,to:until}],r.urgency==="critical")}];})});
   }
   const summary=summarizeRequests(facts,{...filters.period,as_of:asOf},scope.is_test);
   const kpi=await kpiSnapshot(exec,actor,asOf);
   return {...base,available:true,...summary,kpi,operational:{new:items.filter(r=>r.state==="new").length,unassigned:items.filter(r=>r.unassigned&&!["closed","canceled","rejected"].includes(String(r.state))).length,unread:items.filter(r=>r.unread).length,report_pending:items.filter(r=>r.report_pending).length,near_due:null,warning_window_configured:false,unknown_queue:items.filter(r=>r.unassigned===null||r.report_pending===null).length},sample_sizes:{...summary.sample_sizes,incomplete_cycles:items.filter(r=>!r.history_complete).length},...page(items,filters,options)};
  }
  const rows=sourceBound(kind==="tasks"?await queryTaskReport(exec,actor,scope,asOf,filters.period.from,filters.period.to):await queryIncidentReport(exec,actor,scope,asOf));
  const items=rows.filter(r=>kind==="tasks"?(can(actor,"task.manage",{taskAccess:{buildingIds:r.building_ids as string[],assigneeId:text(r.assignee_person_id),isTest:r.is_test===true}}).allow||(r.assignee_person_id===actor.person.id&&r.observed_assignee_person_id===actor.person.id&&can(actor,"task.read",{taskAccess:{buildingIds:r.building_ids as string[],assigneeId:text(r.assignee_person_id),isTest:r.is_test===true}}).allow)):can(actor,"incident.read",{incidentAccess:{buildingIds:r.building_ids as string[],responsibleId:String(r.responsible_person_id),published:false,member:false,isTest:r.is_test===true}}).allow)
   .filter(r=>filters.state===null||r.observed_state===filters.state).map(r=>kind==="tasks"?taskItem(r,scope,asOf):incidentItem(r,asOf));
  if(scope.own_only){const ids=[...new Set(items.flatMap(r=>(r.building_ids as string[])??[]))];filterOptions.buildings=ids.length?await exec.query<{id:string;label:string}>("select id,coalesce(name,'Дом '||code) as label from building where id=any($1::uuid[]) order by code",[ids]):[];}
  const inPeriod=(v:unknown)=>typeof v==="string"&&reportInstantUs(v)>=reportInstantUs(filters.period.from)&&reportInstantUs(v)<reportInstantUs(filters.period.to)&&before(v,asOf);
  const open=items.filter(r=>r.state!==null&&!(kind==="tasks"?["accepted_admin","canceled"]:["completed","not_confirmed"]).includes(String(r.state)));
  const loading=new Map<string,{person_id:string;name:string|null;open:number;accepted:number}>();
  if(kind==="tasks")for(const r of items){if(!r.assignee_person_id)continue;const key=String(r.assignee_person_id),load=loading.get(key)??{person_id:key,name:text(r.assignee_name),open:0,accepted:0};if(open.includes(r))load.open++;if(inPeriod(r.accepted_at)&&r.state==="accepted_admin")load.accepted++;loading.set(key,load);}
  return {...base,available:true,flows:{received:items.filter(r=>inPeriod(r.created_at)).length,completed:items.filter(r=>inPeriod(kind==="tasks"?r.accepted_at:r.completed_at)).length},snapshot:{open:open.length,overdue:open.filter(r=>r.overdue).length,unknown:items.filter(r=>r.state===null).length,unknown_deadline:open.filter(r=>!r.deadline_known).length},durations:{unit:"minutes"},sample_sizes:{objects:items.length,unknown_assignee:kind==="tasks"?items.filter(r=>!r.assignee_known).length:0},operational:{awaiting_acceptance:items.filter(r=>r.state==="awaiting_acceptance").length,rework:items.filter(r=>r.state==="rework").length,on_review:items.filter(r=>r.state==="on_review").length,near_due:null,warning_window_configured:false},workload:[...loading.values()],...page(items,filters,options)};
 });
}
function page(items:Row[],filters:{offset:number;limit:number},options:ReportReadOptions){return {items:options.allRows?items:items.slice(filters.offset,filters.offset+filters.limit),total:items.length,has_more:!options.allRows&&items.length>filters.offset+filters.limit};}
function taskItem(r:Row,scope:ReportScope,asOf:string):Row {const state=text(r.observed_state),deadline=state==="awaiting_acceptance"?r.acceptance_due_at:state==="rework"?r.rework_due_at:r.due_at;
 return {id:r.id,number:r.number,title:r.title,state,building_ids:r.building_ids,assignee_person_id:r.observed_assignee_person_id??null,assignee_name:r.assignee_name,assignee_known:r.assignee_known===true,deadline_known:r.deadline_known===true,created_at:r.created_at,due_at:deadline??null,accepted_at:state==="accepted_admin"?r.accepted_at:null,visits:r.visits,reworks:r.reworks,overdue:![null,"accepted_admin","canceled"].includes(state)&&before(deadline,asOf),own:scope.own_only,calendar_minutes:calendarMinutes(text(r.created_at),state==="accepted_admin"?text(r.accepted_at):asOf)};}
function incidentItem(r:Row,asOf:string):Row {const state=text(r.observed_state),closed=state==="completed"&&before(r.completed_at,asOf)?text(r.completed_at):null;
 return {id:r.id,number:r.number,title:r.title,state,building_ids:r.building_ids,created_at:r.first_signal_at,completed_at:closed,next_update_at:r.next_update_at,deadline_known:r.deadline_known===true,overdue:![null,"completed","not_confirmed"].includes(state)&&before(r.next_update_at,asOf),calendar_minutes:calendarMinutes(text(r.first_signal_at),closed??asOf)};}
