import { beforeEach,expect,it,vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { FileStorage } from "../requests/files.ts";
import { makeTestActor,B1,B2 } from "../../testing/actors.ts";
import { ApiError } from "../../errors/api.ts";
import { processReportExports } from "./jobs.ts";
import { exportPermissionSnapshot,reportExportUrl,getReportExport,REPORT_XLSX_MIME,type ReportExportJob } from "./export.ts";
const source=vi.hoisted(()=>({actor:null as Actor|null,rows:[] as Record<string,unknown>[]}));
vi.mock("./export-actor.ts",()=>({resolveExportActor:vi.fn(async()=>{if(!source.actor)throw new ApiError("FORBIDDEN");return source.actor;})}));
vi.mock("./service.ts",async importOriginal=>({...await importOriginal<typeof import("./service.ts")>(),operationalReport:vi.fn(async()=>({items:source.rows,period:{from:"2026-10-01T00:00:00Z",to:"2026-11-01T00:00:00Z"}}))}));
function fixture(isTest=false){
 const actor=makeTestActor("administrator",[B1,B2],{isTest}),id=crypto.randomUUID();source.actor=actor;source.rows=[];
 const job={id,kind:"tasks",requested_by_person_id:actor.person.id,requested_by_profile_id:actor.profile.id,real_person_id:actor.person.id,real_profile_id:actor.profile.id,emulation_session_id:null,is_test:isTest,
  filters:{from:"2026-10-01",to:"2026-11-01"},permission_snapshot:exportPermissionSnapshot(actor),scope_snapshot:{building_ids:[B1,B2],selected_building_ids:null,include_addressless:true,own_only:false,assignee_id:null,is_test:isTest,buildings:[]},as_of:"2026-10-24T00:00:00Z",state:"pending",attempts:0,lease_token:null,storage_path:null,size_bytes:null,row_count:null,object_ids:[],last_error:null,created_at:"2026-10-24T00:00:00Z"} as ReportExportJob;
 let gate=true;const queries:string[]=[];let storedSize=0;
 const db={async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{queries.push(sql);
  if(sql.includes("pg_try_advisory"))return [{acquired:gate}] as T[];
  if(sql.startsWith("select id,attempts"))return (job.state==="pending"||job.state==="running"?[{id,attempts:job.attempts}]:[]) as T[];
  if(sql.startsWith("select j.*"))return [structuredClone(job)] as T[];
  if(sql.startsWith("update report_export_job set state='running'")){Object.assign(job,{state:"running",attempts:job.attempts+1,lease_token:crypto.randomUUID()});}
  else if(sql.startsWith("update report_export_job set state='ready'")){Object.assign(job,{state:"ready",storage_path:p[2],size_bytes:p[3],row_count:p[4],object_ids:p[5],lease_token:null});}
  else if(sql.startsWith("update report_export_job set state=$3")){Object.assign(job,{state:p[2],last_error:p[3],lease_token:null});}
  else if(sql.startsWith("update report_export_job set state='failed'")){Object.assign(job,{state:"failed",last_error:"EXPORT_FAILED",lease_token:null});}
  if(sql.includes("from task t left join"))return source.rows.map(r=>({id:r.id,is_test:isTest,assignee_person_id:null,building_ids:[B1]})) as T[];
  return [];
 },transaction:<T>(fn:(e:DbExecutor)=>Promise<T>)=>fn(db),close:async()=>{}};
 const storage:FileStorage={put:vi.fn(async(_b,_p,bytes)=>{storedSize=bytes.byteLength;}),info:vi.fn(async()=>({size:storedSize,mime:REPORT_XLSX_MIME})),sign:vi.fn(async()=>"https://private.test/signed")};
 return {actor,job,queries,storage,deps:{db,audit:{append:vi.fn()}} as unknown as RegistryDeps,setGate:(v:boolean)=>{gate=v;}};
}
beforeEach(()=>vi.clearAllMocks());
it("один lease, приватный путь по режиму и сохранённая граница; DTO скрывает внутренние поля",async()=>{
 const h=fixture(true);expect(await processReportExports(h.deps,h.storage)).toBe(1);expect(h.job.state).toBe("ready");expect(h.job.attempts).toBe(1);
 expect(h.storage.put).toHaveBeenCalledWith("internal",expect.stringContaining(`/test/${h.job.id}/`),expect.any(Uint8Array),REPORT_XLSX_MIME);
 const card=await getReportExport(h.deps,h.actor,h.job.id);expect(card).not.toHaveProperty("storage_path");expect(card).not.toHaveProperty("permission_snapshot");
 expect(h.queries[0]).toContain("pg_try_advisory");
});
it("занятый gate не захватывает job и не обращается к Storage",async()=>{
 const h=fixture();h.setGate(false);expect(await processReportExports(h.deps,h.storage)).toBe(0);expect(h.job.attempts).toBe(0);expect(h.storage.put).not.toHaveBeenCalled();
});
it("отзыв области до генерации завершает весь экспорт ошибкой доступа",async()=>{
 const h=fixture();source.actor={...h.actor,assignments:makeTestActor("administrator",[B1]).assignments};await processReportExports(h.deps,h.storage);expect(h.job).toMatchObject({state:"failed",last_error:"ACCESS_REVOKED"});expect(h.storage.put).not.toHaveBeenCalled();
});
it("отзыв области после загрузки файла не разрешает ready и скачивание",async()=>{
 const h=fixture();const put=vi.mocked(h.storage.put).getMockImplementation()!;vi.mocked(h.storage.put).mockImplementation(async(...args)=>{source.actor=null;await put(...args);});
 await processReportExports(h.deps,h.storage);expect(h.job).toMatchObject({state:"failed",last_error:"ACCESS_REVOKED"});await expect(reportExportUrl(h.deps,h.storage,h.actor,h.job.id)).rejects.toMatchObject({code:"FORBIDDEN"});expect(h.storage.sign).not.toHaveBeenCalled();
});
it("старый worker после смены lease не завершает новый запуск",async()=>{
 const h=fixture();vi.mocked(h.storage.info).mockImplementation(async()=>{h.job.lease_token="new-lease";return {size:1,mime:"invalid"};});await processReportExports(h.deps,h.storage);expect(h.job).toMatchObject({state:"running",lease_token:"new-lease"});
});
it("ошибка Storage повторяется не более трёх раз и не выдаёт содержимое ошибки",async()=>{
 const h=fixture();vi.mocked(h.storage.put).mockRejectedValue(new Error("SECRET SQL URL"));for(let i=0;i<3;i++)await processReportExports(h.deps,h.storage);expect(h.job).toMatchObject({state:"failed",attempts:3,last_error:"EXPORT_FAILED"});
});
it("истёкший третий запуск становится failed вместо вечного running",async()=>{
 const h=fixture();Object.assign(h.job,{state:"running",attempts:3,lease_token:"expired"});await processReportExports(h.deps,h.storage);expect(h.job.state).toBe("failed");expect(h.storage.put).not.toHaveBeenCalled();
});
it("готовый файл недоступен после отзыва режима, области или доступа к одной строке",async()=>{
 const h=fixture();source.rows=[{id:crypto.randomUUID(),number:"ЗД-1",title:"Двор",state:"created"}];await processReportExports(h.deps,h.storage);expect(h.job.state).toBe("ready");
 source.rows=[];await expect(reportExportUrl(h.deps,h.storage,h.actor,h.job.id)).rejects.toMatchObject({code:"FORBIDDEN"});expect(h.storage.sign).not.toHaveBeenCalled();
 source.actor={...h.actor,person:{...h.actor.person,isTest:true}};await expect(getReportExport(h.deps,h.actor,h.job.id)).rejects.toMatchObject({code:"FORBIDDEN"});
});
