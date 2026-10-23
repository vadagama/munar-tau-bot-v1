import { ALLOW,deny,type Actor,type Decision,type ResourceRef } from "./types.ts";
/** IDEA/MOD: служебная область, текущая аудитория и ограничение независимы. */
export function initiativeDecision(actor:Actor,action:string,resource:ResourceRef):Decision {
  const r=resource.initiativeAccess,no=()=>deny("Инициатива недоступна");
  if(!r || actor.person.status!=="active" || r.isTest!==actor.person.isTest)return no();
  const manager=r.buildingIds.length>0 && actor.assignments.some(a=>a.role==="chairman" ||
    (["administrator","deputy"].includes(a.role) && (actor.globalStaff || r.buildingIds.every(id=>a.scopeBuildingIds?.includes(id)))));
  if(action==="initiative.create")return r.requestedBuildingIds.length>0 && r.allRequestedMember && !r.restricted?ALLOW:no();
  if(action==="initiative.manage" || action==="initiative.moderate")return manager?ALLOW:no();
  const publicAccess=r.publicationState==="published" && r.member;
  if(action==="initiative.support")return publicAccess && !["completed","rejected"].includes(r.stage??"")?ALLOW:no();
  if(action==="initiative.comment")return publicAccess && !r.restricted?ALLOW:no();
  if(action!=="initiative.read")return no();
  return manager || publicAccess || (r.authorId===actor.person.id && r.publicationState!=="published")?ALLOW:no();
}
