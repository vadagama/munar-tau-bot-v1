import { ApiError } from "../../errors/api.ts";
import { calendarMinutes } from "./durations.ts";
import { REPORT_ZONE,dateParts,zonedInstant } from "./calendar.ts";
export { REPORT_ZONE } from "./calendar.ts";
export interface ReportPeriod {from:string;to:string;timezone:string}
export interface ReportObservation extends ReportPeriod {as_of:string}
function invalid():never {throw new ApiError("VALIDATION_FAILED","Некорректный период отчёта");}
export function reportPeriod(from:string,to:string):ReportPeriod {
 const start=zonedInstant(from),end=zonedInstant(to);if(start>=end)invalid();return {from:new Date(start).toISOString(),to:new Date(end).toISOString(),timezone:REPORT_ZONE};
}
export function kpiPeriod(launchDate:string|null):ReportPeriod|null {
 if(!launchDate)return null;const {year,month,day}=dateParts(launchDate),last=new Date(Date.UTC(year,month+3,0)),end=new Date(Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),Math.min(day,last.getUTCDate()))).toISOString().slice(0,10);return reportPeriod(launchDate,end);
}
export function aggregate(values:number[]){
 if(!values.length)return {mean:null,median:null,n:0};const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 return {mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,median:sorted.length%2?sorted[middle]!:(sorted[middle-1]!+sorted[middle]!)/2,n:sorted.length};
}
export interface RequestReportFact {
 id:string;registered_at:string;final_closed_at:string|null;state_at_as_of:string|null;close_method:string|null;
 rating:number|null;first_response_at:string|null;first_response_working_minutes:number|null;
 overdue:boolean;rework_at:string[];is_test:boolean;is_pilot:boolean;
 canceled_at?:string|null;rejected_at?:string|null;
}
const stamp=(v:string)=>{const n=Date.parse(v);if(!Number.isFinite(n))invalid();return n;};
const unique=(rows:RequestReportFact[])=>[...new Map(rows.map(r=>[r.id,r])).values()];
/** Область PDP применяется источником до вызова; as_of — исключённая граница наблюдения. */
export function summarizeRequests(input:RequestReportFact[],period:ReportObservation,isTest:boolean){
 const from=stamp(period.from),to=stamp(period.to),asOf=stamp(period.as_of);if(from>=to)invalid();
 const observed=(v:string|null|undefined)=>v!=null&&stamp(v)<asOf;
 const inside=(v:string|null|undefined)=>observed(v)&&stamp(v!)>=from&&stamp(v!)<to;
 const rows=unique(input).filter(r=>r.is_test===isTest&&observed(r.registered_at)),cohort=rows.filter(r=>inside(r.registered_at));
 const closed=rows.filter(r=>r.state_at_as_of==="closed"&&inside(r.final_closed_at)),author=closed.filter(r=>r.close_method==="author"),rated=author.filter(r=>r.rating!==null);
 const known=rows.filter(r=>r.state_at_as_of!==null),open=known.filter(r=>!["draft","closed","canceled","rejected"].includes(r.state_at_as_of!));
 const answered=cohort.filter(r=>observed(r.first_response_at)),calendar=answered.map(r=>calendarMinutes(r.registered_at,r.first_response_at)!).filter(v=>v>=0),working=answered.flatMap(r=>r.first_response_working_minutes===null?[]:[r.first_response_working_minutes]);
 const returns=rows.map(r=>r.rework_at.filter(inside).length);
 return {as_of:period.as_of,period:{from:period.from,to:period.to,timezone:period.timezone},
  flows:{received:cohort.length,completed:closed.length,author_confirmed:author.length,admin_closed:closed.filter(r=>r.close_method==="administrative").length,canceled:rows.filter(r=>inside(r.canceled_at)).length,rejected:rows.filter(r=>inside(r.rejected_at)).length,returns:returns.reduce((a,b)=>a+b,0),returned_requests:returns.filter(n=>n>0).length},
  snapshot:{open:open.length,overdue:open.filter(r=>r.overdue).length,unknown:rows.length-known.length},
  durations:{first_response:{calendar:aggregate(calendar),working:aggregate(working)}},
  sample_sizes:{registered:cohort.length,with_response:answered.length,without_response:cohort.length-answered.length,missing_working:answered.length-working.length},
  rating:{mean:rated.length?rated.reduce((sum,r)=>sum+r.rating!,0)/rated.length:null,rated:rated.length,author_closed:author.length,response_percent:author.length?rated.length/author.length*100:null}};
}
export function kpiPeople(rows:{person_id:string;confirmed:boolean;active_connection:boolean;is_test:boolean}[]) {
 return new Set(rows.filter(r=>!r.is_test&&r.confirmed&&r.active_connection).map(r=>r.person_id)).size;
}
export function kpiRequests(rows:RequestReportFact[],period:ReportPeriod) {
 const from=stamp(period.from),to=stamp(period.to);
 return unique(rows).filter(r=>!r.is_test&&!r.is_pilot&&r.state_at_as_of==="closed"&&r.close_method==="author"&&stamp(r.registered_at)>=from&&stamp(r.registered_at)<to&&r.final_closed_at!==null&&stamp(r.final_closed_at)>=from&&stamp(r.final_closed_at)<to).length;
}
