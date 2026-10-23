import type { DbExecutor } from "../../db/client.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { idempotent } from "../requests/service.ts";
import type { FileStorage } from "../requests/files.ts";
import { reportInput } from "./service.ts";
import { reportScope,requestReportAccess,type ReportScope } from "./queries.ts";
import { resolveExportActor } from "./export-actor.ts";
import Workbook from "exceljs/lib/doc/workbook.js";
import type { Actor,ActorAssignment } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { Row } from "../registry/validation.ts";
import type { ReportKind } from "./queries.ts";
import { fmtDate } from "../../bot/text.ts";
export const REPORT_XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export interface ExportPermissionSnapshot {is_test:boolean;roles:{role:"chairman"|"administrator"|"deputy";building_ids:string[]}[]}
export function exportPermissionSnapshot(actor:Actor):ExportPermissionSnapshot {
 if(!can(actor,"report.export").allow)throw new ApiError("FORBIDDEN");
 return {is_test:actor.person.isTest,roles:actor.assignments.filter(a=>["chairman","administrator","deputy"].includes(a.role)).map(a=>({role:a.role as "chairman"|"administrator"|"deputy",building_ids:[...a.scopeBuildingIds??[]]}))};
}
/** Проверка сохранённой геометрии полномочий; рост роли не расширяет источник. */
export function checkExportScope(current:Actor,snapshot:ExportPermissionSnapshot):Actor {
 if(!can(current,"report.export").allow||current.person.isTest!==snapshot.is_test||!snapshot.roles.length)throw new ApiError("FORBIDDEN");
 const chairman=current.assignments.some(a=>a.role==="chairman");
 const assignments:ActorAssignment[]=snapshot.roles.map(old=>{
  const grant=current.assignments.find(a=>a.role==="chairman"||(old.role!=="chairman"&&["administrator","deputy"].includes(a.role)&&old.building_ids.every(id=>(a.scopeBuildingIds??[]).includes(id))));
  if((old.role==="chairman"&&!chairman)||!grant)throw new ApiError("FORBIDDEN");
  return {...grant,role:old.role,scopeBuildingIds:old.building_ids};
 });return {...current,assignments,globalStaff:false};
}
const labels:Record<string,string>={new:"Новое",reviewing:"Рассмотрение",need_clarification:"Уточнение",in_work:"В работе",on_hold:"Отложено",awaiting_confirmation:"Подтверждение автора",rework:"Доработка",closed:"Закрыто",canceled:"Отменено",rejected:"Отклонено",created:"Создано",awaiting_acceptance:"Ожидает принятия",accepted:"Принято исполнителем",in_progress:"Выполняется",suspended:"Приостановлено",on_review:"Проверка",accepted_admin:"Принято ОСИ",signal_check:"Проверка сигнала",confirmed:"Подтверждено",not_confirmed:"Не подтверждено",mitigation:"Устранение",recovery_check:"Проверка восстановления",completed:"Завершено"};
function value(v:unknown):string|number {if(v===null||v===undefined)return "Нет данных";if(typeof v==="number")return Number.isFinite(v)?v:"Нет данных";const s=String(v);return /^[=+\-@\t\r]/.test(s)?`'${s}`:s;}
export async function reportWorkbook(kind:ReportKind,rows:Row[],meta:{from:string;to:string;as_of:string}):Promise<Uint8Array>{
 if(kind==="payments"||rows.length>10000)throw new ApiError("VALIDATION_FAILED");
 const book=new Workbook(),sheet=book.addWorksheet("Отчёт");
 const columns: {header:string;get:(r:Row)=>unknown}[]=kind==="requests"?[
  {header:"Номер",get:r=>r.number},{header:"Категория",get:r=>r.category},{header:"Тип",get:r=>r.kind==="complaint"?"Жалоба":r.kind==="question"?"Вопрос":"Обращение"},
  {header:"Состояние",get:r=>labels[String(r.state)]??"Нет данных"},{header:"Регистрация (Алматы)",get:r=>r.registered_at?fmtDate(String(r.registered_at)):null},
  {header:"Закрытие (Алматы)",get:r=>r.closed_at?fmtDate(String(r.closed_at)):null},{header:"Способ завершения",get:r=>r.close_method==="author"?"Подтверждено автором":r.close_method==="administrative"?"Административное":null},
  {header:"Календарные минуты",get:r=>r.calendar_minutes},{header:"Первый ответ: календарные минуты",get:r=>r.first_response_calendar_minutes},{header:"Первый ответ: рабочие минуты",get:r=>r.first_response_working_minutes},
 ]:kind==="tasks"?[
  {header:"Номер",get:r=>r.number},{header:"Задание",get:r=>r.title},{header:"Состояние",get:r=>labels[String(r.state)]??"Нет данных"},{header:"Исполнитель",get:r=>r.assignee_name},
  {header:"Срок (Алматы)",get:r=>r.due_at?fmtDate(String(r.due_at)):null},{header:"Приёмка (Алматы)",get:r=>r.accepted_at?fmtDate(String(r.accepted_at)):null},
  {header:"Календарные минуты",get:r=>r.calendar_minutes},{header:"Визиты за период",get:r=>r.visits},{header:"Возвраты за период",get:r=>r.reworks},
 ]:[{header:"Номер",get:r=>r.number},{header:"Инцидент",get:r=>r.title},{header:"Состояние",get:r=>labels[String(r.state)]??"Нет данных"},{header:"Первый сигнал (Алматы)",get:r=>fmtDate(String(r.created_at))},{header:"Завершение (Алматы)",get:r=>r.completed_at?fmtDate(String(r.completed_at)):null},{header:"Обновление (Алматы)",get:r=>r.next_update_at?fmtDate(String(r.next_update_at)):null},{header:"Календарные минуты",get:r=>r.calendar_minutes}];
 sheet.columns=columns.map((c,i)=>({header:c.header,key:String(i),width:26}));sheet.views=[{state:"frozen",ySplit:1}];sheet.getRow(1).font={bold:true};
 for(const row of rows){const saved=sheet.addRow(columns.map(c=>value(c.get(row))));saved.eachCell(cell=>{if(typeof cell.value==="string")cell.numFmt="@";});}
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:columns.length}};
 const settings=book.addWorksheet("Параметры");settings.columns=[{width:36},{width:40}];for(const [key,v] of [["От (включительно)",meta.from],["До (исключительно)",meta.to],["Срез (исключительно)",meta.as_of],["Часовой пояс","Asia/Almaty"]])settings.addRow([key,value(v)]);
 const bytes=new Uint8Array(await book.xlsx.writeBuffer());if(bytes.byteLength>20*1024*1024)throw new ApiError("FILE_LIMIT","Отчёт превышает 20 МиБ");return bytes;
}

export interface ReportExportJob extends Row {
 id:string;kind:Exclude<ReportKind,"payments">;requested_by_person_id:string;requested_by_profile_id:string;
 real_person_id:string;real_profile_id:string;emulation_session_id:string|null;is_test:boolean;
 filters:Row;permission_snapshot:ExportPermissionSnapshot;scope_snapshot:ReportScope;as_of:string;
 state:"pending"|"running"|"ready"|"failed";attempts:number;lease_token:string|null;
 storage_path:string|null;size_bytes:number|null;row_count:number|null;object_ids:string[];last_error:string|null;created_at:string;
}
export function exportEmulation(job:ReportExportJob){return job.emulation_session_id?{sessionId:job.emulation_session_id,realPersonId:job.real_person_id,realProfileId:job.real_profile_id}:null;}
export async function reportExportJob(exec:DbExecutor,id:string,lock=false){
 const [row]=await exec.query<ReportExportJob>(`select j.*,j.as_of::text as as_of,j.created_at::text as created_at from report_export_job j where j.id=$1${lock?" for update":""}`,[id]);if(!row)throw new ApiError("NOT_FOUND");return row;
}
export async function exportResourcesAllowed(exec:DbExecutor,actor:Actor,job:ReportExportJob){
 const ids=job.object_ids??[];if(!ids.length)return;
 let rows:Row[]=[];
 if(job.kind==="requests")rows=await exec.query("select id,state,is_test,building_id,complaint_subject_person_id,complaint_route from request where id=any($1::uuid[])",[ids]);
 else if(job.kind==="tasks")rows=await exec.query(`select t.id,t.is_test,t.assignee_person_id,case when t.request_id is not null then array_remove(array[r.building_id],null) else w.building_ids end as building_ids from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id where t.id=any($1::uuid[])`,[ids]);
 else rows=await exec.query("select i.id,i.is_test,i.responsible_person_id,array(select s.building_id from incident_scope s where s.incident_id=i.id and s.active) as building_ids from incident i where i.id=any($1::uuid[])",[ids]);
 if(rows.length!==new Set(ids).size||rows.some(r=>job.kind==="requests"?!requestReportAccess(actor,r):!can(actor,job.kind==="tasks"?"task.read":"incident.read",job.kind==="tasks"?{taskAccess:{buildingIds:r.building_ids as string[],assigneeId:r.assignee_person_id as string|null,isTest:r.is_test===true}}:{incidentAccess:{buildingIds:r.building_ids as string[],responsibleId:String(r.responsible_person_id),isTest:r.is_test===true,published:false,member:false}}).allow))throw new ApiError("FORBIDDEN");
}
function creator(actor:Actor,job:ReportExportJob){
 if(actor.person.id!==job.requested_by_person_id||actor.profile.id!==job.requested_by_profile_id||actor.person.isTest!==job.is_test||
   (actor.emulation?.sessionId??null)!==job.emulation_session_id||(actor.emulation?.realProfileId??actor.profile.id)!==job.real_profile_id||
   (actor.emulation?.realPersonId??actor.person.id)!==job.real_person_id)throw new ApiError("NOT_FOUND");
}
export function reportExportCard(job:ReportExportJob){return {id:job.id,kind:job.kind,state:job.state,attempts:job.attempts,as_of:job.as_of,filters:job.filters,is_test:job.is_test,created_at:job.created_at,row_count:job.row_count,size_bytes:job.size_bytes,error:job.last_error};}
export async function getReportExport(deps:RegistryDeps,actor:Actor,id:string){
 return deps.db.transaction(async exec=>{await lockAudience(exec);const job=await reportExportJob(exec,id);creator(actor,job);
  const current=await resolveExportActor(exec,job.requested_by_profile_id,exportEmulation(job));checkExportScope(current,job.permission_snapshot);
  if(job.state==="ready")await exportResourcesAllowed(exec,current,job);return reportExportCard(job);
 });
}
export async function createReportExport(deps:RegistryDeps,actor:Actor,input:Row,key:unknown){
 if(!can(actor,"report.export").allow)throw new ApiError("FORBIDDEN");const {kind,...filters}=input;
 if(!["requests","tasks","incidents"].includes(String(kind)))throw new ApiError("VALIDATION_FAILED","Источник недоступен для экспорта");
 const typedKind=kind as Exclude<ReportKind,"payments">;reportInput(filters);
 return deps.db.transaction(async exec=>{await lockAudience(exec);const current=await resolveExportActor(exec,actor.profile.id,actor.emulation);
  return idempotent(exec,current,"report.export.create",key,input,async()=>{
   const scope=await reportScope(exec,current,typedKind,filters),permission=exportPermissionSnapshot(current);
   const [clock]=await exec.query<{at:string}>("select clock_timestamp()::text as at");if(!clock)throw new Error("Серверное время недоступно");
   const [job]=await exec.query<ReportExportJob>(`insert into report_export_job(kind,requested_by_person_id,requested_by_profile_id,real_person_id,real_profile_id,emulation_session_id,is_test,filters,permission_snapshot,scope_snapshot,as_of)
    values($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9::text::jsonb,$10::text::jsonb,$11) returning *`,[typedKind,current.person.id,current.profile.id,current.emulation?.realPersonId??current.person.id,current.emulation?.realProfileId??current.profile.id,current.emulation?.sessionId??null,current.person.isTest,JSON.stringify(filters),JSON.stringify(permission),JSON.stringify(scope),clock.at]);
   if(!job)throw new Error("Экспорт не поставлен в очередь");
   await recordAudit(deps,exec,current,"report.export.queued","report_export",job.id,scope.building_ids,null,{kind:typedKind,from:filters.from,to:filters.to,as_of:clock.at},"Экспорт операционного отчёта");return reportExportCard(job);
  },async response=>{const job=await reportExportJob(exec,String(response.id));creator(current,job);checkExportScope(current,job.permission_snapshot);if(job.state==="ready")await exportResourcesAllowed(exec,current,job);});
 });
}
export async function reportExportUrl(deps:RegistryDeps,storage:FileStorage,actor:Actor,id:string){
 return deps.db.transaction(async exec=>{await lockAudience(exec);const job=await reportExportJob(exec,id);creator(actor,job);
  const current=await resolveExportActor(exec,job.requested_by_profile_id,exportEmulation(job));checkExportScope(current,job.permission_snapshot);await exportResourcesAllowed(exec,current,job);
  if(job.state!=="ready"||!job.storage_path)throw new ApiError("INVALID_TRANSITION","Файл ещё не готов");
  const url=await storage.sign("internal",job.storage_path,300);
  await recordAudit(deps,exec,current,"report.export.download","report_export",id,job.scope_snapshot.building_ids,null,{kind:job.kind,as_of:job.as_of,rows:job.row_count},"Скачивание операционного отчёта");
  return {url,expires_in:300,filename:`report-${job.kind}-${job.id}.xlsx`};
 });
}
