import { ALLOW,deny,type Actor,type Decision,type ResourceRef } from "./types.ts";
export function moderationDecision(actor:Actor,action:string,resource:ResourceRef):Decision {
 const r=resource.moderationAccess,no=()=>deny("Действие модерации недоступно");
 if(!r||r.isTest!==actor.person.isTest||actor.person.status!=="active")return no();
 const own=r.targetPersonId===actor.person.id,chair=actor.assignments.some(a=>a.role==="chairman");
 const manager=chair||(r.buildingIds.length>0&&actor.assignments.some(a=>["administrator","deputy"].includes(a.role)&&(actor.globalStaff||r.buildingIds.every(id=>a.scopeBuildingIds?.includes(id)))));
 if(action==="moderation.resolve")return chair?ALLOW:no();
 if(action==="moderation.appeal")return own?ALLOW:no();
 return action==="moderation.read"&&(own||manager)?ALLOW:no();
}
