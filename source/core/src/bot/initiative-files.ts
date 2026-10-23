import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import { actorForTelegram } from "./registration.ts";
import { loadDialog } from "./dialog.ts";
import { initiativeStep } from "./initiatives.ts";
import { prepareFile } from "../domains/requests/files.ts";
import { idempotent } from "../domains/requests/service.ts";
import { lockAudience } from "../domains/registry/audience-lock.ts";
import { requireInitiative } from "../domains/initiatives/access.ts";
import { message,messageButton } from "../templates/message.ts";
import { btn,type BotReply } from "./keyboard.ts";
/** Принимает только явный режим фото; сетевой перенос остаётся в устойчивой очереди. */
export async function queueInitiativePhoto(deps:RegistryDeps,telegram:string,media:Row,updateId:unknown):Promise<BotReply>{
 const actor=await actorForTelegram(deps,telegram);if(!actor)throw new ApiError("FORBIDDEN");
 const bot=deps.bot??"resident",state=await loadDialog(deps.db,telegram,bot,actor.profile.id,actor.emulation?.sessionId??null,"initiatives");
 if(bot!=="resident"||state.idea_step!=="photos")return initiativeStep(deps,telegram,"",actor);
 const lang=actor.profile.language,back=()=>[[btn(messageButton(deps.templates,lang,"initiatives.controls","back"),`/initiative ${state.idea_id}`)]];
 // Симулятор не содержит настоящих Telegram file_id; тестовые файлы загружаются через кабинет.
 if(actor.person.isTest)return {text:message(deps.templates,lang,"initiatives.photo_test"),buttons:back()};
 const photos=media.photo as Row[]|undefined,item=(media.document??photos?.[photos.length-1]) as Row|undefined;
 if(!item||typeof item.file_id!=="string")return {text:message(deps.templates,lang,"initiatives.photo_prompt"),buttons:back()};
 await deps.db.transaction(async exec=>{await lockAudience(exec);
  await idempotent(exec,actor,"initiative.telegram.photo",`initiative-photo:${updateId}`,{id:state.idea_id,file:item.file_id},async()=>{
   const db={...deps.db,query:exec.query.bind(exec),transaction:<T>(fn:(e:typeof exec)=>Promise<T>)=>fn(exec)};
   const row=await requireInitiative(exec,actor,String(state.idea_id),"initiative.attach",true);
   const f=await prepareFile({...deps,db},actor,{owner_type:"initiative",owner_id:row.id,expected_version:row.version,filename:item.file_name??"photo.jpg",size:item.file_size,mime:item.mime_type??"image/jpeg"});
   await exec.query("insert into request_upload_job(attachment_id,telegram_file_id,person_id,bot) values($1,$2,$3,'resident')",[f.attachment_id,item.file_id,actor.person.id]);return {id:row.id};
  },()=>requireInitiative(exec,actor,String(state.idea_id),"initiative.attach"));
 });
 return {text:message(deps.templates,lang,"initiatives.photo_queued"),buttons:[[btn(messageButton(deps.templates,lang,"initiatives.controls","photos"),`/ip ${state.idea_id}`)],...back()]};
}
