import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { resolveExportActor } from "./export-actor.ts";
import { dateParts } from "./calendar.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { idempotent } from "../requests/service.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import { invalid,type Row } from "../registry/validation.ts";
export async function configureReportLaunch(deps:RegistryDeps,actor:Actor,input:Row,key:unknown){
 if(!can(actor,"report.configure").allow)throw new ApiError("FORBIDDEN");
 if(Object.keys(input).some(k=>!["launched_on","reason"].includes(k))||typeof input.launched_on!=="string"||typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>2000)invalid("Укажите дату и причину запуска");
 dateParts(input.launched_on);const reason=input.reason.trim();
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  const current=await resolveExportActor(exec,actor.profile.id,actor.emulation);if(!can(current,"report.configure").allow)throw new ApiError("FORBIDDEN");
  return idempotent(exec,current,"report.configure",key,input,async()=>{
   const [row]=await exec.query<{id:string;launched_on:string;created_at:string}>(`insert into report_launch(launched_on,created_by,reason) values($1,$2,$3) returning id,launched_on::text,created_at::text`,[input.launched_on,current.person.id,reason]);
   if(!row)throw new Error("Дата запуска не сохранена");
   await recordAudit(deps,exec,current,"report.configure","report_launch",row.id,[],null,{launched_on:row.launched_on},reason);return row;
  });
 });
}
