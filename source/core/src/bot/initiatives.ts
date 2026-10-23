import { listInitiativePhotos,discardInitiativePhoto } from "../domains/initiatives/files.ts";
import { fileUrl } from "../domains/requests/files.ts";
import { ApiError } from "../errors/api.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { getInitiative,listInitiatives,initiativeSubmissionOptions,getModerationAction,listModerationActions } from "../domains/initiatives/queries.ts";
import { submitInitiative } from "../domains/initiatives/service.ts";
import { setInitiativeSupport } from "../domains/initiatives/support.ts";
import { addInitiativeComment,listInitiativeComments,readInitiativeComment } from "../domains/initiatives/comments.ts";
import { appealModerationAction } from "../domains/initiatives/moderation.ts";
import { actorForTelegram } from "./registration.ts";
import { loadDialog,saveDialog } from "./dialog.ts";
import { btn,type BotReply,type InlineButton } from "./keyboard.ts";
import { esc,fmtDate } from "./text.ts";
import { message,messageButton,safeBlock } from "../templates/message.ts";
import { BotTemplateError } from "./bot-errors.ts";
export const INITIATIVE_COMMANDS=["/ip","/if","/initiatives","/initiative","/inew","/ia","/ic","/im","/imods"];
const nonce=()=>crypto.randomUUID().replaceAll("-","").slice(0,16);
function uuid(value:string|undefined):string {if(!value||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value))throw new ApiError("VALIDATION_FAILED");return value.toLowerCase();}
function offset(value:string|undefined,maximum=100000){const n=Number(value??0);if(!Number.isSafeInteger(n)||n<0||n>maximum)throw new ApiError("VALIDATION_FAILED");return n;}
/** Формы связаны с bot/profile/emulation context и nonce; все записи — общий домен. */
export async function initiativeStep(deps:RegistryDeps,telegram:string,input:string,providedActor?:Actor):Promise<BotReply>{
 const actor=providedActor??await actorForTelegram(deps,telegram);if(!actor)throw new ApiError("FORBIDDEN");
 const bot=deps.bot??"resident",lang=actor.profile.language,state=await loadDialog(deps.db,telegram,bot,actor.profile.id,actor.emulation?.sessionId??null,"initiatives");
 const t=(key:string,vars:Row={})=>message(deps.templates,lang,`initiatives.${key}`,vars),b=(key:string,data:string,vars:Row={})=>btn(messageButton(deps.templates,lang,"initiatives.controls",key,vars),data);
 const save=()=>saveDialog(deps.db,telegram,bot,state),clear=()=>{for(const key of Object.keys(state))if(key!=="scenario")delete state[key];};
 const [command,arg,action,index]=input.trim().split(/\s+/),listButton=()=>[b("list","/initiatives")];
 if(command==="/start"&&arg?.startsWith("idea_"))return initiativeStep(deps,telegram,`/initiative ${arg.slice(5)}`,actor);
 if(command==="/start"&&arg?.startsWith("mod_"))return initiativeStep(deps,telegram,`/im ${arg.slice(4)}`,actor);
 function prompt(step=String(state.idea_step)){return {text:t(step),buttons:[listButton()]} as BotReply;}
 function field(value:string,max:number){if(!value.trim()||value.trim().length>max)throw new BotTemplateError("VALIDATION_FAILED",t("invalid",{limit:max}));return value.trim();}
 async function houses(page=0):Promise<BotReply>{
  const rows=state.idea_houses as {id:string;label:string}[],chosen=state.idea_chosen as string[],token=String(state.idea_token),start=offset(String(page),100)*8;
  if(start>=rows.length&&start!==0)throw new ApiError("VALIDATION_FAILED");
  return {text:t("houses"),buttons:[...rows.slice(start,start+8).map((row,i)=>[b("house",`/ia ${token} h ${start+i}`,{name:row.label,selected:chosen.includes(row.id)?"✓":"○"})]),
   [...(start?[b("prev",`/ia ${token} hp ${page-1}`)]:[]),...(rows.length>start+8?[b("next",`/ia ${token} hp ${page+1}`)]:[])],
   [b("review",`/ia ${token} review`)],listButton()].filter(row=>row.length)};
 }
 if(command==="/initiatives"||command==="/imods"){
  clear();await save();const at=offset(arg),moderation=command==="/imods";
  const rows:InlineButton[][]=[];
  if(moderation){const result=await listModerationActions(deps,actor,{offset:at,limit:10});for(const [i,row] of result.items.entries())rows.push([b("open",`/im ${row.id}`,{title:`${at+i+1}. ${row.reason.slice(0,50)}`})]);if(result.has_more)rows.push([b("next",`/imods ${at+10}`)]);}
  else {const result=await listInitiatives(deps,actor,{offset:at,limit:10});for(const [i,row] of result.items.entries())rows.push([b("open",`/initiative ${row.id}`,{title:`${at+i+1}. ${row.title.slice(0,50)}`})]);if(result.has_more)rows.push([b("next",`/initiatives ${at+10}`)]);}
  const empty=!rows.length;if(at)rows.push([b("prev",`${command} ${Math.max(0,at-10)}`)]);
  if(!moderation){if(bot==="resident")rows.push([b("new","/inew")]);rows.push([b("moderation","/imods")]);}else rows.push(listButton());
  return {text:t(moderation?(empty?"moderation_empty":"moderation_list"):(empty?"empty":"list")),buttons:rows};
 }
 if(command==="/inew"){
  if(bot!=="resident")throw new ApiError("FORBIDDEN");const choices=await initiativeSubmissionOptions(deps,actor);
  clear();state.idea_token=nonce();state.idea_step="title";state.idea_draft={};state.idea_houses=choices;state.idea_chosen=[];await save();return prompt();
 }
 if(command==="/initiative"){
  const card=await getInitiative(deps,actor,uuid(arg));clear();state.idea_token=nonce();state.idea_step="card";state.idea_id=card.id;state.idea_version=card.version;state.idea_support_version=card.own_support.version;await save();
  const rows:InlineButton[][]=[];
  if(bot==="resident"&&card.can_support)rows.push([b(card.own_support.supported?"withdraw":"support",`/ia ${state.idea_token} ${card.own_support.supported?"withdraw":"support"}`)]);
  if(bot==="resident"&&card.can_comment)rows.push([b("comment",`/ia ${state.idea_token} comment`)]);
  rows.push([b("photos",`/ip ${card.id}`)]);
  rows.push([b("comments",`/ic ${card.id} 0`)],[b("refresh",`/initiative ${card.id}`)],listButton());
  return {text:t("card",{title:card.title,body:card.body,location:card.location_text,stage:t(`state.${card.stage??card.publication_state}`),count:card.support_count,reason:card.stage_reason??card.review_reason??"—"}),buttons:rows};
 }
 if(command==="/ip"){
  const card=await getInitiative(deps,actor,uuid(arg)),photos=await listInitiativePhotos(deps,actor,card.id);clear();state.idea_id=card.id;state.idea_version=card.version;state.idea_token=nonce();state.idea_step="photos";state.idea_photos=photos.map(p=>p.id);await save();
  const rows:InlineButton[][]=[];
  for(const [n,p] of photos.entries()){
   if(p.status==="complete")rows.push([b("photo_open",`/if ${p.id}`,{title:p.filename})]);
   if(bot==="resident"&&card.can_attach)rows.push([b("photo_remove",`/ia ${state.idea_token} photoremove ${n}`,{title:p.filename})]);
  }
  return {text:t(bot==="resident"&&card.can_attach?"photo_prompt":"photo_list"),buttons:[...rows,[b("refresh",`/ip ${card.id}`)],[b("back",`/initiative ${card.id}`)],listButton()]};
 }
 if(command==="/if"){
  if(!deps.fileStorage)throw new ApiError("INVALID_TRANSITION");const result=await fileUrl(deps,deps.fileStorage,actor,uuid(arg));
  return {text:t("photo_link",{body:safeBlock(`<a href="${esc(String(result.url))}">${esc(messageButton(deps.templates,lang,"initiatives.controls","photos"))}</a>`)}),buttons:[listButton()]};
 }
 if(command==="/ic"){
  const id=uuid(arg),at=offset(action,10000),result=await listInitiativeComments(deps,actor,id,at);clear();await save();
  return {text:result.items.length?result.items.map(c=>t("comment_item",{name:c.author_name,body:c.body,hidden:c.hidden?t("hidden"):""})).join("\n\n"):t("comments_empty"),buttons:[...(at?[[b("prev",`/ic ${id} ${Math.max(0,at-20)}`)]]:[]),...(result.has_more?[[b("next",`/ic ${id} ${at+20}`)]]:[]),[b("back",`/initiative ${id}`)],listButton()]};
 }
 if(command==="/im"){
  const card=await getModerationAction(deps,actor,uuid(arg));clear();state.idea_token=nonce();state.idea_step="moderation";state.idea_action=card.id;state.idea_action_version=card.version;await save();
  let body=t("moderation_card",{kind:t(card.kind==="hide_comment"?"hidden":"restricted"),reason:card.reason,until:fmtDate(card.until_at)});
  if(card.comment_id){const comment=await readInitiativeComment(deps,actor,card.comment_id);body+="\n"+t("comment_item",{name:comment.author_name,body:comment.body,hidden:comment.hidden?t("hidden"):""});}
  for(const decision of card.decisions)body+="\n"+t("decision",{resolution:t(`resolution.${decision.resolution}`),reason:decision.reason,until:fmtDate(decision.until_at)});
  return {text:body,buttons:[...(bot==="resident"&&card.can_appeal?[[b("appeal",`/ia ${state.idea_token} appeal`)]]:[]),[b("moderation","/imods")],listButton()]};
 }
 if(command==="/ia"){
  if(bot!=="resident")throw new ApiError("FORBIDDEN");if(!arg||arg!==state.idea_token)throw new ApiError("CONCURRENT_MODIFICATION");
  const step=String(state.idea_step),token=String(state.idea_token);
  if(action==="photoremove"&&step==="photos"){
   const at=offset(index,9),photo=(state.idea_photos as string[])[at];if(!photo)throw new ApiError("VALIDATION_FAILED");
   await discardInitiativePhoto(deps,actor,String(state.idea_id),photo,{expected_version:state.idea_version},`initiative-photo-discard:${token}:${photo}`);
   return initiativeStep(deps,telegram,`/ip ${state.idea_id}`,actor);
  }
  if(action==="resume"){
   if(step==="photos")return initiativeStep(deps,telegram,`/ip ${state.idea_id}`,actor);
   if(step==="card")return initiativeStep(deps,telegram,`/initiative ${state.idea_id}`,actor);
   if(step==="moderation")return initiativeStep(deps,telegram,`/im ${state.idea_action}`,actor);
   if(step==="houses")return houses();
   if(step==="preview"){const draft=state.idea_draft as Row;return {text:t("preview",{title:draft.title,body:draft.body,location:draft.location_text,houses:(state.idea_houses as {id:string;label:string}[]).filter(h=>(state.idea_chosen as string[]).includes(h.id)).map(h=>h.label).join(", ")}),buttons:[[b("submit",`/ia ${token} submit`)],listButton()]};}
   if(step==="comment_preview"||step==="appeal_preview")return {text:t("text_preview",{body:step==="comment_preview"?state.idea_comment:state.idea_reason}),buttons:[[b("confirm",`/ia ${token} ${step==="comment_preview"?"comment":"appeal"}confirm`)],listButton()]};
   return prompt();
  }
  if((action==="h"||action==="hp"||action==="review")&&step==="houses"){
   if((action==="h"||action==="hp")&&index===undefined)throw new ApiError("VALIDATION_FAILED");
   if(action==="hp")return houses(offset(index,100));
   if(action==="h"){const selected=offset(index,99),row=(state.idea_houses as {id:string;label:string}[])[selected];if(!row)throw new ApiError("VALIDATION_FAILED");
    const fresh=await initiativeSubmissionOptions(deps,actor);if(!fresh.some(h=>h.id===row.id))throw new ApiError("NOT_FOUND");const chosen=state.idea_chosen as string[];state.idea_chosen=chosen.includes(row.id)?chosen.filter(id=>id!==row.id):[...chosen,row.id];await save();return houses(Math.floor(selected/8));}
   const selected=state.idea_chosen as string[];if(!selected.length)throw new BotTemplateError("VALIDATION_FAILED",t("choose_house"));
   state.idea_step="preview";await save();const draft=state.idea_draft as Row;return {text:t("preview",{title:draft.title,body:draft.body,location:draft.location_text,houses:(state.idea_houses as {id:string;label:string}[]).filter(h=>selected.includes(h.id)).map(h=>h.label).join(", ")}),buttons:[[b("submit",`/ia ${token} submit`)],listButton()]};
  }
  if(action==="submit"&&step==="preview"){
   const draft=state.idea_draft as Row,result=await submitInitiative(deps,actor,{title:draft.title,body:draft.body,location_text:draft.location_text,building_ids:state.idea_chosen},`initiative-form:${token}`);
   return initiativeStep(deps,telegram,`/initiative ${result.id}`,actor);
  }
  if(["support","withdraw","comment","commentconfirm"].includes(action??"")&&state.idea_id){
   const card=await getInitiative(deps,actor,String(state.idea_id));if(card.version!==state.idea_version)throw new ApiError("CONCURRENT_MODIFICATION");
   if((action==="support"||action==="withdraw")&&step==="card"){
    if(!card.can_support)throw new ApiError("NOT_FOUND");if(card.own_support.version!==state.idea_support_version)throw new ApiError("CONCURRENT_MODIFICATION");
    await setInitiativeSupport(deps,actor,card.id,action==="support",{expected_version:state.idea_support_version},`initiative-support:${token}`);return initiativeStep(deps,telegram,`/initiative ${card.id}`,actor);
   }
   if(!card.can_comment)throw new ApiError("NOT_FOUND");
   if(action==="comment"&&step==="card"){state.idea_step="comment";await save();return prompt();}
   if(action==="commentconfirm"&&step==="comment_preview"){await addInitiativeComment(deps,actor,card.id,{body:state.idea_comment,expected_version:state.idea_version},`initiative-comment:${token}`);return initiativeStep(deps,telegram,`/initiative ${card.id}`,actor);}
  }
  if((action==="appeal"||action==="appealconfirm")&&state.idea_action){
   const card=await getModerationAction(deps,actor,String(state.idea_action));if(card.version!==state.idea_action_version)throw new ApiError("CONCURRENT_MODIFICATION");if(!card.can_appeal)throw new ApiError("NOT_FOUND");
   if(action==="appeal"&&step==="moderation"){state.idea_step="appeal";await save();return prompt();}
   if(action==="appealconfirm"&&step==="appeal_preview"){await appealModerationAction(deps,actor,card.id,{reason:state.idea_reason,expected_version:state.idea_action_version},`initiative-appeal:${token}`);clear();await save();return {text:t("appeal_saved"),buttons:[[b("moderation","/imods")],listButton()]};}
  }
  throw new ApiError("CONCURRENT_MODIFICATION");
 }
 if(input.trim()&&!input.trim().startsWith("/")&&bot==="resident"){
  const step=String(state.idea_step),draft=state.idea_draft as Row,token=String(state.idea_token);
  if(step==="title"||step==="body"||step==="location"){
   draft[step==="location"?"location_text":step]=field(input,step==="title"?300:step==="body"?10000:500);
   state.idea_step=step==="title"?"body":step==="body"?"location":"houses";await save();return state.idea_step==="houses"?houses():prompt();
  }
  if(step==="comment"||step==="appeal"){
   const text=field(input,step==="comment"?10000:2000);state[step==="comment"?"idea_comment":"idea_reason"]=text;state.idea_step=`${step}_preview`;await save();
   return {text:t("text_preview",{body:text}),buttons:[[b("confirm",`/ia ${token} ${step}confirm`)],listButton()]};
  }
 }
 return {text:t("buttons_only"),buttons:[...(bot==="resident"&&state.idea_token?[[b("resume",`/ia ${state.idea_token} resume`)]]:[]),listButton()]};
}
