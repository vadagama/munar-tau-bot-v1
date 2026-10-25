import type { RuleParams } from "../registry/time.ts";
import { validateRuleChange } from "../timing/rules.ts";
import { ApiError } from "../../errors/api.ts";
import { reportInstantUs,zonedInstant } from "./calendar.ts";
export interface TimeInterval {from:string;to:string}
const instant=reportInstantUs;
const min=(a:bigint,b:bigint)=>a<b?a:b,max=(a:bigint,b:bigint)=>a>b?a:b;
export function calendarMinutes(from:string|null,to:string|null):number|null {
 if(from===null||to===null)return null;const start=instant(from),end=instant(to);if(start>end)throw new ApiError("VALIDATION_FAILED","Обратный интервал времени");return Number(end-start)/60000000;
}
function merged(from:bigint,to:bigint,active:TimeInterval[]):[bigint,bigint][] {
 const parts=active.map(a=>[max(from,instant(a.from)),min(to,instant(a.to))] as [bigint,bigint]).filter(([a,b])=>a<b).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),result:[bigint,bigint][]=[];
 for(const [a,b] of parts){const last=result.at(-1);if(last&&a<=last[1])last[1]=max(last[1],b);else result.push([a,b]);}return result;
}
/** Только сохранённая версия и известная история активности. Разные таймеры считаются отдельно. */
export function workingMinutes(from:string,to:string,rule:RuleParams|null,active:TimeInterval[]|null,emergency=false):number|null {
 const start=instant(from),end=instant(to);if(start>end)throw new ApiError("VALIDATION_FAILED");
 if(active===null||(!rule&&!emergency))return null;const intervals=merged(start,end,active);
 if(!emergency)validateRuleChange("operational",null,rule);
 if(emergency||rule!.clock==="calendar")return Number(intervals.reduce((sum,[a,b])=>sum+b-a,0n))/60000000;
 const zone=rule!.timezone??"Asia/Almaty",days=rule!.days??[0,1,2,3,4,5,6];
 const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"});
 const date=(n:bigint)=>{const p=Object.fromEntries(formatter.formatToParts(new Date(Number(n/1000n))).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
 let total=0n;
 for(const [a,b] of intervals){const first=date(a),last=date(b);let day=Date.parse(first+"T00:00:00Z");const lastDay=Date.parse(last+"T00:00:00Z");
  for(;day<=lastDay;day+=86400000){const d=new Date(day);if(!days.includes(d.getUTCDay()))continue;
   const local=d.toISOString().slice(0,10),opens=BigInt(zonedInstant(local,rule!.start??8,zone))*1000n,closes=BigInt(zonedInstant(local,rule!.end??20,zone))*1000n;
   total+=max(0n,min(b,closes)-max(a,opens));
  }
 }
 return Number(total)/60000000;
}
export interface ReportCycle {number:number;from:string;to:string|null;wait:TimeInterval[]}
export function cycleDurations(cycles:ReportCycle[],asOf:string) {
 const cutoff=instant(asOf);
 return cycles.filter(c=>instant(c.from)<cutoff).map(c=>{const end=c.to&&instant(c.to)<cutoff?c.to:asOf;
  return {number:c.number,calendar_minutes:calendarMinutes(c.from,end),waiting_minutes:Number(merged(instant(c.from),instant(end),c.wait).reduce((sum,[a,b])=>sum+b-a,0n))/60000000,ended:c.to!==null&&instant(c.to)<cutoff};});
}
