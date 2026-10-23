import { expect,it } from "vitest";
import { captureReportKpi,requestCycles } from "./history.ts";
const at=(h:number)=>`2026-10-23T${String(h).padStart(2,"0")}:00:00Z`;
const event=(id:number,from:string|null,to:string,action:string,h:number)=>({id:String(id),at:at(h),kind:"state" as const,from_state:from,to_state:to,action,confirmation_version:1});
it("регистрация, ожидание, возврат, закрытие и повторное открытие образуют независимые циклы",()=>{
 const rows=[event(1,null,"new","created",3),event(2,"new","awaiting_confirmation","submit_result",4),event(3,"awaiting_confirmation","rework","return_result",5),event(4,"rework","awaiting_confirmation","submit_result",6),event(5,"awaiting_confirmation","closed","confirm_result",7),event(6,"closed","rework","reopen",8)];
 const result=requestCycles(rows,at(10));expect(result.complete).toBe(true);expect(result.cycles).toEqual([
 {number:1,from:at(3),to:at(5),wait:[{from:at(4),to:at(5)}]},
 {number:2,from:at(5),to:at(7),wait:[{from:at(6),to:at(7)}]},
 {number:3,from:at(8),to:null,wait:[]},
 ]);expect(result.final_closed_at).toBeNull();expect(requestCycles(rows,at(8)).final_closed_at).toBe(at(7));
});
it("отсутствующая регистрация/пропуск перехода — неизвестная история, без выдуманного цикла",()=>{
 expect(requestCycles([event(1,"in_work","closed","confirm_result",5)],at(10))).toMatchObject({complete:false,cycles:[],final_closed_at:null});
 expect(requestCycles([event(1,null,"new","created",3),event(2,"in_work","closed","confirm_result",5)],at(10)).complete).toBe(false);
});
it("ожидание обрезается as_of, отзыв результата завершает ожидание без нового цикла",()=>{
 const rows=[event(1,null,"new","created",3),event(2,"new","awaiting_confirmation","submit_result",4),event(3,"awaiting_confirmation","in_work","withdraw_report",5)];
 expect(requestCycles(rows,at(6)).cycles).toEqual([{number:1,from:at(3),to:null,wait:[{from:at(4),to:at(5)}]}]);expect(requestCycles(rows,at(5)).cycles[0]!.wait).toEqual([{from:at(4),to:at(5)}]);
});

it("микросекундная граница PostgreSQL сохраняет состояние снимка",()=>{
 const first=event(1,null,"new","created",3),closed={...event(2,"new","closed","confirm_result",4),at:"2026-10-23T04:00:00.000200Z"};
 expect(requestCycles([first,closed],"2026-10-23T04:00:00.000500Z").final_closed_at).toBe(closed.at);expect(requestCycles([first,closed],closed.at).final_closed_at).toBeNull();
});

it("занятый gate не задерживает доставку уведомлений за бюджет jobs",async()=>{
 const calls:string[]=[];const db={async query<T>(sql:string):Promise<T[]>{calls.push(sql);return [{acquired:false}] as T[];},transaction:<T>(fn:(exec:import("../../db/client.ts").DbExecutor)=>Promise<T>)=>fn(db),close:async()=>{}};
 expect(await captureReportKpi(db)).toBe(0);expect(calls).toEqual(["select pg_try_advisory_xact_lock(814733,8) as acquired"]);
});
