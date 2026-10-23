import type { RuleParams } from "../registry/time.ts";
import { validateRuleChange } from "../timing/rules.ts";
import { ApiError } from "../../errors/api.ts";
import { zonedInstant } from "./calendar.ts";
export interface TimeInterval {from:string;to:string}
function instant(v:string){const n=Date.parse(v);if(!Number.isFinite(n))throw new ApiError("VALIDATION_FAILED","Некорректная граница времени");return n;}
export function calendarMinutes(from:string|null,to:string|null):number|null {
 if(from===null||to===null)return null;const start=instant(from),end=instant(to);if(start>end)throw new ApiError("VALIDATION_FAILED","Обратный интервал времени");return (end-start)/60000;
}
function merged(from:number,to:number,active:TimeInterval[]):[number,number][] {
 const parts=active.map(a=>[Math.max(from,instant(a.from)),Math.min(to,instant(a.to))] as [number,number]).filter(([a,b])=>a<b).sort((a,b)=>a[0]-b[0]),result:[number,number][]=[];
 for(const [a,b] of parts){const last=result.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else result.push([a,b]);}return result;
}
/** Только сохранённая версия и известная история активности. Разные таймеры считаются отдельно. */
export function workingMinutes(from:string,to:string,rule:RuleParams|null,active:TimeInterval[]|null,emergency=false):number|null {
 const start=instant(from),end=instant(to);if(start>end)throw new ApiError("VALIDATION_FAILED");
 if(active===null||(!rule&&!emergency))return null;const intervals=merged(start,end,active);
 if(!emergency)validateRuleChange("operational",null,rule);
 if(emergency||rule!.clock==="calendar")return intervals.reduce((sum,[a,b])=>sum+b-a,0)/60000;
 const zone=rule!.timezone??"Asia/Almaty",days=rule!.days??[0,1,2,3,4,5,6];
 const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"});
 const date=(n:number)=>{const p=Object.fromEntries(formatter.formatToParts(new Date(n)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
 let total=0;
 for(const [a,b] of intervals){const first=date(a),last=date(b);let day=Date.parse(first+"T00:00:00Z");const lastDay=Date.parse(last+"T00:00:00Z");
  for(;day<=lastDay;day+=86400000){const d=new Date(day);if(!days.includes(d.getUTCDay()))continue;
   const local=d.toISOString().slice(0,10),opens=zonedInstant(local,rule!.start??8,zone),closes=zonedInstant(local,rule!.end??20,zone);
   total+=Math.max(0,Math.min(b,closes)-Math.max(a,opens));
  }
 }
 return total/60000;
}
export interface ReportCycle {number:number;from:string;to:string|null;wait:TimeInterval[]}
export function cycleDurations(cycles:ReportCycle[],asOf:string) {
 const cutoff=instant(asOf);
 return cycles.filter(c=>instant(c.from)<cutoff).map(c=>{const end=c.to&&instant(c.to)<cutoff?c.to:asOf;
  return {number:c.number,calendar_minutes:calendarMinutes(c.from,end),waiting_minutes:merged(instant(c.from),instant(end),c.wait).reduce((sum,[a,b])=>sum+b-a,0)/60000,ended:c.to!==null&&instant(c.to)<cutoff};});
}
