import { ALLOW,deny,type Actor,type Decision } from "./types.ts";
export function reportDecision(actor:Actor,action:string):Decision {
 if(actor.person.status!=="active")return deny("Отчёт недоступен");
 const roles=actor.assignments.map(a=>a.role),manager=roles.some(r=>["chairman","administrator","deputy"].includes(r));
 const allowed=action==="report.requests"?manager:
 action==="report.tasks"?roles.length>0:
 action==="report.incidents"?manager||roles.includes("duty"):
 action==="report.payments"?manager||roles.includes("finance"):
 action==="report.export"?roles.some(r=>["chairman","administrator"].includes(r)):
 action==="report.configure"?roles.includes("chairman")&&!actor.emulation:false;
 return allowed?ALLOW:deny("Нет полномочий для отчёта");
}
