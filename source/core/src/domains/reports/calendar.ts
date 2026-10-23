import { ApiError } from "../../errors/api.ts";
export const REPORT_ZONE="Asia/Almaty";
function invalid():never {throw new ApiError("VALIDATION_FAILED","Некорректный период отчёта");}
export function dateParts(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid();const [year,month,day]=value.split("-").map(Number) as [number,number,number];
 if(year<1000||year>9998||new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==value)invalid();return {year,month,day};
}
/** Локальное время через IANA, без зашитого UTC-смещения и часового пояса процесса. */
export function zonedInstant(date:string,hour=0,zone=REPORT_ZONE):number {
 const {year,month,day}=dateParts(date),target=Date.UTC(year,month-1,day,hour),formatter=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 let cursor=target;
 for(let n=0;n<4;n++){
  const p=Object.fromEntries(formatter.formatToParts(new Date(cursor)).map(p=>[p.type,p.value]));
  const wall=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
  if(wall===target)return cursor;cursor+=target-wall;
 }
 return invalid();
}
/** ISO/PG text сохраняет дробь до микросекунд; SQL-источник читает at::text, не Date. */
export function reportInstantUs(value:string):bigint {
 const milliseconds=Date.parse(value),match=/[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
 if(!Number.isFinite(milliseconds)||!match)invalid();return BigInt(milliseconds)*1000n+BigInt((match[1]??"").padEnd(6,"0").slice(3));
}
