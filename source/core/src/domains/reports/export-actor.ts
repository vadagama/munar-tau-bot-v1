import type { DbExecutor } from "../../db/client.ts";
import type { Actor,ActorEmulation } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { SqlAdminRepo } from "../admin/repo.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
async function profileActor(exec:DbExecutor,id:string){const repo=new SqlAdminRepo(),profile=await repo.getProfile(exec,id);if(!profile||profile.archivedAt)throw new ApiError("FORBIDDEN");const actor=await buildActorForProfile(repo,exec,profile,new Date());if(actor.person.status!=="active"||actor.profile.isTest!==actor.person.isTest)throw new ApiError("FORBIDDEN");return actor;}
export async function resolveExportActor(exec:DbExecutor,profileId:string,emulation:ActorEmulation|null):Promise<Actor>{
 const actor=await profileActor(exec,profileId);
 if(emulation){
  const [session]=await exec.query("select id from emulation_session where id=$1 and tech_admin_profile_id=$2 and emulated_profile_id=$3 and state='active' and ended_at is null",[emulation.sessionId,emulation.realProfileId,profileId]);
  const real=await profileActor(exec,emulation.realProfileId);
  if(!session||real.person.id!==emulation.realPersonId||!real.assignments.some(a=>a.role==="tech_admin")||!actor.person.isTest)throw new ApiError("FORBIDDEN");
  actor.emulation=emulation;
 }
 if(!can(actor,"report.export").allow)throw new ApiError("FORBIDDEN");return actor;
}
