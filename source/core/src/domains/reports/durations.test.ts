import { expect,it } from "vitest";
import { calendarMinutes,workingMinutes,cycleDurations } from "./durations.ts";
const rule={hours:2,clock:"working" as const,start:8,end:20,timezone:"Asia/Almaty",days:[1,2,3,4,5]};
it("ночь/выходной: календарное время растёт, рабочее начинается при открытии; секунды не теряются",()=>{
 const from="2026-10-23T14:59:30Z",to="2026-10-26T03:00:30Z";
 expect(calendarMinutes(from,to)).toBe(3601);expect(workingMinutes(from,to,rule,[{from,to}])).toBe(1);
 expect(workingMinutes(from,to,rule,[{from,to}],true)).toBe(3601);
});
it("пересечение с разрешённой активностью, перекрытия не удваиваются; отсутствие версии/истории не означает ноль",()=>{
 const from="2026-10-23T03:00:00Z",to="2026-10-23T05:00:00Z",active=[{from,to:"2026-10-23T04:00:00Z"},{from:"2026-10-23T03:30:00Z",to:"2026-10-23T04:30:00Z"}];
 expect(workingMinutes(from,to,rule,active)).toBe(90);expect(workingMinutes(from,to,null,active)).toBeNull();expect(workingMinutes(from,to,rule,null)).toBeNull();expect(workingMinutes(from,to,rule,[])).toBe(0);
 expect(workingMinutes(from,to,{...rule,end:9},[{from,to}])).toBe(60);expect(calendarMinutes(null,to)).toBeNull();
});
it("два возврата и ожидание сохраняются отдельно, прежнее закрытие не растёт и правила не суммируются",()=>{
 const cycles=[{number:1,from:"2026-10-23T03:00:00Z",to:"2026-10-23T04:00:00Z",wait:[{from:"2026-10-23T03:30:00Z",to:"2026-10-23T04:00:00Z"}]},{number:2,from:"2026-10-23T04:00:00Z",to:null,wait:[]}];
 const result=cycleDurations(cycles,"2026-10-23T06:00:00Z");expect(result).toEqual([{number:1,calendar_minutes:60,waiting_minutes:30,ended:true},{number:2,calendar_minutes:120,waiting_minutes:0,ended:false}]);
 expect(calendarMinutes("2026-10-23T03:00:00Z","2026-10-23T04:00:00Z")).toBe(60);
});

it("рабочие и календарные длительности сохраняют микросекундный край",()=>{
 const from="2026-10-23T03:00:00.000200Z",to="2026-10-23T03:00:00.000500Z";expect(calendarMinutes(from,to)).toBe(0.000005);expect(workingMinutes(from,to,rule,[{from,to}])).toBe(0.000005);
});
