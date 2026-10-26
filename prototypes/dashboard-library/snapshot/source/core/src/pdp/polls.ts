import { ALLOW, deny, type Actor, type Decision, type ResourceRef } from "./types.ts";

/** POL-01–04: менеджер получает только агрегаты, служебная роль не даёт голоса. */
export function pollDecision(actor: Actor, action: string, resource: ResourceRef): Decision {
  const r=resource.pollAccess, no=()=>deny("Опрос недоступен");
  if(!r || actor.person.status!=="active" || r.isTest!==actor.person.isTest || !r.buildingIds.length) return no();
  const manager=actor.assignments.some(a=>a.role==="chairman" ||
    (["administrator","deputy"].includes(a.role) && (actor.globalStaff || r.buildingIds.every(id=>a.scopeBuildingIds?.includes(id)))));
  if(action==="poll.manage") return manager ? ALLOW : no();
  if(action==="poll.answer") return r.state==="open" && r.answerOpen && r.member ? ALLOW : no();
  if(action==="poll.results") {
    if(r.state==="canceled" || r.state==="draft") return no();
    return manager || (r.state==="closed" && r.finalParticipant) ? ALLOW : no();
  }
  if(action!=="poll.read") return no();
  return manager || (r.state!=="draft" && (r.member || r.participant || r.finalParticipant)) ? ALLOW : no();
}
