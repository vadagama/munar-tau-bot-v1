import type { Actor } from "../pdp/types.ts";
import { ApiError } from "../errors/api.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { operationalReport } from "../domains/reports/service.ts";
import { publishedPlans } from "../domains/reports/plans.ts";
import { actorForTelegram } from "./registration.ts";
import { loadDialog } from "./dialog.ts";
import { btn,type BotReply,type InlineButton } from "./keyboard.ts";
import { esc,fmtDate } from "./text.ts";
import { message,messageButton,safeBlock } from "../templates/message.ts";
export const REPORT_COMMANDS=["/mywork","/plans"];
export async function reportStep(deps:RegistryDeps,telegram:string,input:string,providedActor?:Actor):Promise<BotReply>{
 const actor=providedActor??await actorForTelegram(deps,telegram);if(!actor)throw new ApiError("FORBIDDEN");
 const [command,offsetText,...extra]=input.trim().split(/\s+/),offset=Number(offsetText??0);
 if(!REPORT_COMMANDS.includes(command??"")||extra.length||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new ApiError("VALIDATION_FAILED");
 const bot=deps.bot??"resident",lang=actor.profile.language;
 if(command==="/mywork"&&bot!=="worker")throw new ApiError("FORBIDDEN");
 await loadDialog(deps.db,telegram,bot,actor.profile.id,actor.emulation?.sessionId??null,"reports");
 const text=(id:string,vars:Record<string,unknown>={})=>message(deps.templates,lang,`reports.${id}`,vars);
 const button=(id:string,data:string,vars:Record<string,unknown>={})=>btn(messageButton(deps.templates,lang,"reports.controls",id,vars),data);
 const navigation:InlineButton[]=[];if(offset)navigation.push(button("prev",`${command} ${Math.max(0,offset-10)}`));
 if(command==="/mywork"){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit"}).formatToParts(new Date()).map(p=>[p.type,p.value])),from=`${p.year}-${p.month}-01`,to=new Date(Date.UTC(Number(p.year),Number(p.month),1)).toISOString().slice(0,10);
  const report=await operationalReport(deps,actor,"tasks",{from,to,assignee_id:actor.person.id,offset,limit:10});
  if(!("items" in report))throw new ApiError("FORBIDDEN");
  const username=deps.workerBotUsername??"munar_tau_worker_bot";if(!/^[A-Za-z0-9_]+$/.test(username))throw new ApiError("INTERNAL");
  const lines=report.items.map(r=>`<a href="https://t.me/${username}?start=wrk_${esc(r.id)}">${esc(r.number)}</a> · ${esc(String(r.title).slice(0,100))}`);
  if(report.has_more)navigation.push(button("next",`/mywork ${offset+10}`));
  return {text:text("mywork",{at:fmtDate(report.as_of),open:report.snapshot.open,overdue:report.snapshot.overdue,completed:report.flows.completed,unknown:report.snapshot.unknown,pending:report.operational.awaiting_acceptance,review:report.operational.on_review,items:safeBlock(lines.length?lines.join("\n\n"):text("empty"))}),buttons:[[button("refresh",`/mywork ${offset}`),button("tasks","/tasks")],...(navigation.length?[navigation]:[])]};
 }
 const {items,has_more}=await publishedPlans(deps,actor,offset);
 if(has_more)navigation.push(button("next",`/plans ${offset+10}`));
 return {text:text(items.length?"plans":"empty"),buttons:[...items.map(r=>[button("open",`/publication ${r.id}`,{title:String(r.title).slice(0,64)})]),[button("refresh",`/plans ${offset}`),button("publications","/publications")],...(navigation.length?[navigation]:[])]};
}
