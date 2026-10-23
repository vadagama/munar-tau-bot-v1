import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { recordAudit } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import type { FileStorage } from "../requests/files.ts";
import { resolveExportActor } from "./export-actor.ts";
import { checkExportScope,exportEmulation,exportResourcesAllowed,reportExportJob,reportWorkbook,REPORT_XLSX_MIME,type ReportExportJob } from "./export.ts";
import { operationalReport } from "./service.ts";

async function gate(exec:DbExecutor,deadline:number){
 if(Date.now()>=deadline)return false;
 const [row]=await exec.query<{acquired:boolean}>("select pg_try_advisory_xact_lock(814733,8) as acquired");
 if(!row?.acquired)return false;
 await exec.query("select set_config('statement_timeout',$1,true)",[String(Math.max(1,deadline-Date.now()))]);
 await lockAudience(exec);return Date.now()<deadline;
}
function owned(job:ReportExportJob,token:string){return job.state==="running"&&job.lease_token===token;}
async function failed(deps:RegistryDeps,job:ReportExportJob,error:unknown,deadline:number){
 const denied=error instanceof ApiError&&["FORBIDDEN","NOT_FOUND"].includes(error.code);
 const tooLarge=error instanceof ApiError&&(error.code==="FILE_LIMIT"||(error.code==="VALIDATION_FAILED"&&error.message.includes("10000")));
 const code=denied?"ACCESS_REVOKED":tooLarge?"REPORT_TOO_LARGE":"EXPORT_FAILED";
 await deps.db.transaction(async exec=>{if(!await gate(exec,deadline))return;
  const current=await reportExportJob(exec,job.id,true);if(!owned(current,job.lease_token!))return;
  await exec.query(`update report_export_job set state=$3,last_error=$4,lease_token=null,lease_until=null,
   finished_at=case when $3='failed' then clock_timestamp() else null end where id=$1 and lease_token=$2`,
   [job.id,job.lease_token,denied||tooLarge||current.attempts>=3?"failed":"pending",code]);
 });
}
/** Не более одного файла за вызов. Gate → строка job; Excel/Storage вне транзакции. */
export async function processReportExports(deps:RegistryDeps,storage:FileStorage,deadline=Date.now()+30000):Promise<number>{
 if(Date.now()+1000>=deadline)return 0;
 const job=await deps.db.transaction(async exec=>{
  if(!await gate(exec,deadline))return null;
  const [candidate]=await exec.query<{id:string;attempts:number}>(`select id,attempts from report_export_job
   where state='pending' or (state='running' and lease_until<=clock_timestamp()) order by created_at,id limit 1 for update skip locked`);
  if(!candidate)return null;
  if(candidate.attempts>=3){await exec.query(`update report_export_job set state='failed',last_error='EXPORT_FAILED',lease_token=null,lease_until=null,finished_at=clock_timestamp() where id=$1`,[candidate.id]);return null;}
  await exec.query(`update report_export_job set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',last_error=null where id=$1`,[candidate.id]);
  return reportExportJob(exec,candidate.id);
 });
 if(!job)return 0;
 try{
  const report=await deps.db.transaction(async exec=>{
   if(!await gate(exec,deadline))return null;
   const current=await resolveExportActor(exec,job.requested_by_profile_id,exportEmulation(job)),bounded=checkExportScope(current,job.permission_snapshot);
   const db={query:exec.query.bind(exec),transaction:<T>(fn:(e:DbExecutor)=>Promise<T>)=>fn(exec),close:async()=>{}};
   return operationalReport({...deps,db},bounded,job.kind,job.filters,{asOf:job.as_of,allRows:true});
  });
  if(!report||!("items" in report))return 0;
  const items=report.items;
  if(Date.now()+1000>=deadline)return 0;
  const bytes=await reportWorkbook(job.kind,items,{...report.period,as_of:job.as_of});
  if(Date.now()+1000>=deadline)return 0;
  const path=`reports/${job.is_test?"test":"real"}/${job.id}/${job.lease_token}.xlsx`;
  await storage.put("internal",path,bytes,REPORT_XLSX_MIME);
  const info=await storage.info("internal",path);
  if(info.size!==bytes.byteLength||info.mime!==REPORT_XLSX_MIME)throw new Error("Storage metadata mismatch");
  return await deps.db.transaction(async exec=>{
   if(!await gate(exec,deadline))return 0;
   const leased=await reportExportJob(exec,job.id,true);if(!owned(leased,job.lease_token!))return 0;
   const current=await resolveExportActor(exec,job.requested_by_profile_id,exportEmulation(job));checkExportScope(current,job.permission_snapshot);
   const ids=items.map(r=>String(r.id));if(new Set(ids).size!==ids.length)throw new Error("Duplicate report objects");
   await exportResourcesAllowed(exec,current,{...leased,object_ids:ids});
   await exec.query(`update report_export_job set state='ready',storage_path=$3,size_bytes=$4,row_count=$5,object_ids=$6::uuid[],lease_token=null,lease_until=null,last_error=null,finished_at=clock_timestamp() where id=$1 and lease_token=$2`,[job.id,job.lease_token,path,bytes.byteLength,ids.length,ids]);
   await recordAudit(deps,exec,current,"report.export.ready","report_export",job.id,job.scope_snapshot.building_ids,null,{kind:job.kind,as_of:job.as_of,rows:ids.length},"Операционный отчёт сформирован");return 1;
  });
 }catch(error){await failed(deps,job,error,deadline);return 0;}
}
