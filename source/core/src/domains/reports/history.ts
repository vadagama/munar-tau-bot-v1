import { reportInstantUs } from "./calendar.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { ReportCycle } from "./durations.ts";
export interface RequestReportEvent {id:string;at:string;kind:"state"|"response";from_state:string|null;to_state:string|null;action:string;confirmation_version:number}
/** Только наблюдавшиеся переходы; закрытый цикл никогда не перезаписывается. */
export function requestCycles(input:RequestReportEvent[],asOf:string){
 const cutoff=reportInstantUs(asOf),events=input.filter(e=>e.kind==="state"&&reportInstantUs(e.at)<cutoff).sort((a,b)=>(reportInstantUs(a.at)<reportInstantUs(b.at)?-1:reportInstantUs(a.at)>reportInstantUs(b.at)?1:BigInt(a.id)<BigInt(b.id)?-1:1));
 const cycles:ReportCycle[]=[];let current:ReportCycle|null=null,waiting:string|null=null,state:string|null=null,complete=true,registered:string|null=null,closed:string|null=null;
 for(const e of events){
  if(!registered){if(e.to_state!=="new"||!["created","submitted"].includes(e.action))continue;registered=e.at;current={number:1,from:e.at,to:null,wait:[]};cycles.push(current);state="new";continue;}
  if(e.from_state!==state)complete=false;
  if(waiting&&e.to_state!=="awaiting_confirmation"){current!.wait.push({from:waiting,to:e.at});waiting=null;}
  if(["return_result","reopen"].includes(e.action)){
   if(current&&!current.to)current.to=e.at;
   current={number:cycles.length+1,from:e.at,to:null,wait:[]};cycles.push(current);closed=null;
  }
  if(e.to_state==="awaiting_confirmation"&&!waiting)waiting=e.at;
  if(e.to_state==="closed"){if(current&&!current.to)current.to=e.at;closed=e.at;}
  state=e.to_state;
 }
 if(waiting&&current)current.wait.push({from:waiting,to:asOf});
 return {complete:complete&&registered!==null,registered_at:registered,final_closed_at:closed,state_at_as_of:state,cycles};
}
/** Вызывается только для содержательного служебного сообщения resident внутри общей транзакции. */
export async function recordReportResponse(exec:DbExecutor,requestId:string,messageId:string) {
 await exec.query(`insert into report_request_event(request_id,kind,at,action,request_version,confirmation_version,is_test,message_id)
  select r.id,'response',m.created_at,'staff_response',r.version,r.confirmation_version,r.is_test,m.id
  from request r join message m on m.request_id=r.id where r.id=$1 and m.id=$2 and m.channel='resident' and length(btrim(m.text))>0
  on conflict do nothing`,[requestId,messageId]);
}

export async function captureReportKpi(db:import("../../db/client.ts").DbClient,deadline=Date.now()+30000) {
 if(Date.now()>=deadline)return 0;
 try{return await db.transaction(async exec=>{
  const [gate]=await exec.query<{acquired:boolean}>("select pg_try_advisory_xact_lock(814733,8) as acquired");
  if(!gate?.acquired)return 0;
  await lockAudience(exec);const remaining=deadline-Date.now();if(remaining<=0)return 0;
  await exec.query("select set_config('statement_timeout',$1,true)",[String(remaining)]);
  const [row]=await exec.query<{processed:number}>("select public.capture_report_kpi() as processed");return row?.processed??0;
 });}catch(e){if((e as {code?:string}).code==="57014")return 0;throw e;}
}
