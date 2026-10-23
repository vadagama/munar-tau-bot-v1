import { initiativeFields } from "./input.ts";
import { SqlAdminRepo } from "../admin/repo.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { initiativeRow,requireInitiative } from "./access.ts";
import type { InitiativeRow } from "./types.ts";
export async function requireInitiativePhoto(exec:DbExecutor,actor:Actor,a:Row,write=false) {
 if(a.owner_type!=="initiative"||a.discarded_at||a.bucket!=="resident")throw new ApiError("NOT_FOUND");
 const row=await requireInitiative(exec,actor,String(a.owner_id),write?"initiative.attach":"initiative.read",write);
 if(write&&a.uploaded_by!==actor.person.id)throw new ApiError("NOT_FOUND");return row;
}
/** Состав материалов входит в версию рассматриваемой подачи. Gate и parent lock уже взяты. */
export async function advanceInitiativePhotos(deps:RegistryDeps,exec:DbExecutor,actor:Actor,row:InitiativeRow,action:string) {
 const [updated]=await exec.query<InitiativeRow>("update initiative set version=version+1 where id=$1 returning *",[row.id]);
 if(!updated)throw new Error("Версия материалов не сохранена");
 const reason="Изменение фотографий инициативы";
 await exec.query(`insert into initiative_log(initiative_id,version,action,publication_state,stage,reason,by_person_id)
  values($1,$2,$3,$4,$5,$6,$7)`,[row.id,updated.version,action,row.publication_state,row.stage,reason,actor.person.id]);
 await recordAudit(deps,exec,actor,action,"initiative",row.id,row.requested_building_ids,{version:row.version},{version:updated.version},reason);
 return updated.version;
}
export async function listInitiativePhotos(deps:RegistryDeps,actor:Actor,id:string) {
 return deps.db.transaction(async exec=>{await lockAudience(exec);await requireInitiative(exec,actor,id);
 return exec.query<Row>("select id,filename,size_bytes,mime,status from attachment where owner_type='initiative' and owner_id=$1 and discarded_at is null order by created_at,id limit 10",[id]);});
}
export async function discardInitiativePhoto(deps:RegistryDeps,actor:Actor,id:string,fileId:string,input:Row,key:unknown) {
 initiativeFields(input,["expected_version"]);
 return deps.db.transaction(async exec=>{await lockAudience(exec);
 return idempotent(exec,actor,`initiative.photo.discard:${fileId}`,key,input,async()=>{
  const row=await requireInitiative(exec,actor,id,"initiative.attach",true);checkVersion(row.version,input.expected_version);
  const [a]=await exec.query<Row>("select * from attachment where id=$1 for update",[fileId]);
  if(!a||a.owner_id!==id)throw new ApiError("NOT_FOUND");await requireInitiativePhoto(exec,actor,a,true);
  await exec.query("update attachment set discarded_at=clock_timestamp() where id=$1",[fileId]);
  const version=await advanceInitiativePhotos(deps,exec,actor,row,"initiative.photo.discard");return {id,attachment_id:fileId,version};
 },()=>requireInitiative(exec,actor,id,"initiative.attach"));});
}
/** Канонический актор фоновой загрузки; тестовый Telegram file_id не скачивается. */
export async function initiativeUploadActor(exec:DbExecutor,attachmentId:string,personId:string) {
 const [a]=await exec.query<Row>("select * from attachment where id=$1",[attachmentId]);
 if(!a||a.uploaded_by!==personId)throw new ApiError("NOT_FOUND");
 const row=await initiativeRow(exec,String(a.owner_id));if(row.is_test)throw new ApiError("FORBIDDEN");
 const [profile]=await exec.query<{id:string}>("select id from profile where person_id=$1 and archived_at is null and is_test=false order by id limit 1",[personId]);
 if(!profile)throw new ApiError("NOT_FOUND");const repo=new SqlAdminRepo(),p=await repo.getProfile(exec,profile.id);if(!p)throw new ApiError("NOT_FOUND");
 const actor=await buildActorForProfile(repo,exec,p,new Date());await requireInitiativePhoto(exec,actor,a,true);return {actor,attachment:a,row};
}
