import { fmtDate } from "../../bot/text.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import { invalid,type Row } from "../registry/validation.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { enqueueNotice } from "../notifications/service.ts";
import type { DbExecutor } from "../../db/client.ts";
import { initiativeAudience,requireInitiative } from "./access.ts";
import { initiativeFields,initiativeText,initiativeUuid } from "./input.ts";
import { commentRow } from "./comments.ts";
import { appealCard,moderationCard,requireModeration,type ModerationRow,type AppealRow } from "./moderation-access.ts";
function until(value:unknown,now:Date):string {
 if(typeof value!=="string"||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<=now.getTime())invalid("Укажите будущий конечный срок с часовым поясом");
 return new Date(value).toISOString();
}
async function notify(exec:DbExecutor,row:ModerationRow,resolution:"uphold"|"shorten"|"revoke"|null=null,reason=row.reason) {
 await enqueueNotice(exec,{personId:row.target_person_id,key:`moderation.${resolution??"created"}:${row.id}:${row.version}`,
  template:`notices.initiatives.moderation_${resolution??(row.kind==="hide_comment"?"hidden":"restricted")}`,vars:{reason,until:fmtDate(row.until_at)},
  moderationActionId:row.id,type:"personal",audience:"personal",bot:"resident",isTest:row.is_test});
}
export async function readModerationAction(deps:RegistryDeps,actor:Actor,id:string) {return moderationCard(await requireModeration(deps.db,actor,id));}
export async function createModerationAction(deps:RegistryDeps,actor:Actor,input:Row,key:unknown) {
 initiativeFields(input,["initiative_id","kind","comment_id","reason","until_at","expected_version"]);
 const id=initiativeUuid(input.initiative_id,"инициатива"),reason=initiativeText(input.reason,"причину",2000);
 if(input.kind!=="hide_comment"&&input.kind!=="restrict_author")invalid("Неизвестное действие модерации");
 const kind=input.kind;
 if(kind==="hide_comment"&&input.until_at!==undefined)invalid("Скрытие не имеет срока");
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  return idempotent(exec,actor,"moderation.create",key,input,async()=>{
   const item=await requireInitiative(exec,actor,id,"initiative.moderate",true);checkVersion(item.version,input.expected_version);
   let target=item.author_person_id,commentId:string|null=null;
   if(input.comment_id!==undefined){const comment=await commentRow(exec,initiativeUuid(input.comment_id,"комментарий"));if(comment.initiative_id!==id||comment.is_test!==item.is_test)throw new ApiError("NOT_FOUND");target=comment.author_person_id;if(kind==="hide_comment")commentId=comment.id;}
   if(kind==="hide_comment"&&!commentId)invalid("Выберите комментарий");
   if(commentId&&(await exec.query("select id from moderation_action where target_comment_id=$1 and kind='hide_comment' and revoked_at is null",[commentId])).length)throw new ApiError("INVALID_TRANSITION");
   const clock=await initiativeAudience(exec,actor.person.id,actor.person.isTest),end=kind==="restrict_author"?until(input.until_at,clock.at):null;
   const [row]=await exec.query<ModerationRow>(`insert into moderation_action(initiative_id,kind,target_person_id,target_comment_id,reason,original_until_at,until_at,created_by,is_test)
    values($1,$2,$3,$4,$5,$6,$6,$7,$8) returning *`,[id,kind,target,commentId,reason,end,actor.person.id,item.is_test]);
   if(!row)throw new Error("Модерация не сохранена");await notify(exec,row);
   await recordAudit(deps,exec,actor,"initiative.moderate","moderation_action",row.id,item.approved_building_ids.length?item.approved_building_ids:item.requested_building_ids,null,{version:1,kind},"Решение модерации инициативы");
   return moderationCard(row);
  },response=>requireModeration(exec,actor,response.id));
 });
}
export async function appealModerationAction(deps:RegistryDeps,actor:Actor,id:string,input:Row,key:unknown) {
 initiativeFields(input,["reason","expected_version"]);const reason=initiativeText(input.reason,"обоснование оспаривания",2000);
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  return idempotent(exec,actor,`moderation.appeal:${id}`,key,input,async()=>{
   const action=await requireModeration(exec,actor,id,"moderation.appeal",true);checkVersion(action.version,input.expected_version);
   if(action.revoked_at||(await exec.query("select id from moderation_appeal where action_id=$1 and status='open'",[id])).length)throw new ApiError("INVALID_TRANSITION");
   const [row]=await exec.query<AppealRow>(`insert into moderation_appeal(action_id,appellant_person_id,reason) values($1,$2,$3) returning *`,[id,actor.person.id,reason]);
   if(!row)throw new Error("Оспаривание не сохранено");
   await recordAudit(deps,exec,actor,"moderation.appeal","moderation_appeal",row.id,[],null,{version:1},"Оспаривание решения модерации");
   return appealCard(row);
  },()=>requireModeration(exec,actor,id,"moderation.appeal"));
 });
}
export async function resolveModerationAppeal(deps:RegistryDeps,actor:Actor,id:string,input:Row,key:unknown) {
 initiativeFields(input,["resolution","reason","until_at","expected_version","action_expected_version"]);
 const reason=initiativeText(input.reason,"основание решения",2000),resolution=input.resolution;
 if(!["uphold","shorten","revoke"].includes(String(resolution)))invalid("Неизвестное решение");
 if(resolution!=="shorten"&&input.until_at!==undefined)invalid("Срок меняется только решением о сокращении");
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  return idempotent(exec,actor,`moderation.resolve:${id}`,key,input,async()=>{
   const [appeal]=await exec.query<AppealRow>("select * from moderation_appeal where id=$1 for update",[id]);if(!appeal)throw new ApiError("NOT_FOUND");
   const action=await requireModeration(exec,actor,appeal.action_id,"moderation.resolve",true);
   checkVersion(appeal.version,input.expected_version);checkVersion(action.version,input.action_expected_version);
   if(appeal.status!=="open")throw new ApiError("INVALID_TRANSITION");
   const clock=await initiativeAudience(exec,actor.person.id,actor.person.isTest);
   let end=action.until_at;
   if(resolution==="shorten"){
    if(action.kind!=="restrict_author"||action.revoked_at||!action.until_at)invalid("Срок можно сократить только для ограничения");
    const next=until(input.until_at,clock.at);if(Date.parse(next)>=new Date(action.until_at).getTime())invalid("Новый срок должен быть короче действующего");end=new Date(next);
   }
   const [updated]=await exec.query<ModerationRow>(`update moderation_action set until_at=$2,revoked_at=$3,version=version+1 where id=$1 returning *`,[action.id,end,resolution==="revoke"?clock.at_text:action.revoked_at]);
   if(!updated)throw new Error("Решение не сохранено");
   await exec.query(`insert into moderation_decision(appeal_id,action_id,resolution,reason,before_version,after_version,until_at,by_person_id)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,[id,action.id,resolution,reason,action.version,updated.version,updated.until_at,actor.person.id]);
   const [done]=await exec.query<AppealRow>("update moderation_appeal set status='resolved',resolved_at=clock_timestamp(),version=version+1 where id=$1 returning *",[id]);if(!done)throw new Error("Оспаривание не закрыто");
   await notify(exec,updated,resolution as "uphold"|"shorten"|"revoke",reason);
   await recordAudit(deps,exec,actor,"moderation.resolve","moderation_appeal",id,[],{version:appeal.version},{version:done.version,resolution},"Рассмотрение оспаривания модерации");
   return appealCard(done);
  },async response=>{await requireModeration(exec,actor,response.action_id,"moderation.resolve");});
 });
}
