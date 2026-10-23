import { expect,it } from "vitest";
import { reportScope,requestReportAccess } from "./queries.ts";
import { operationalReport } from "./service.ts";
import { makeTestActor,B1,B2 } from "../../testing/actors.ts";
import type { DbClient } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
function fixture(rows:Row[]=[]){const queries:{sql:string;p:readonly unknown[]}[]=[];const db:DbClient={async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{queries.push({sql,p});if(sql.startsWith("select clock_timestamp"))return [{at:"2026-10-24T10:00:00.000500Z"}] as T[];if(sql.startsWith("select id,coalesce(name"))return [{id:B1},{id:B2}] as T[];if(sql.includes("/* report.requests */")||sql.includes("/* report.tasks */")||sql.includes("/* report.incidents */"))return rows as T[];if(sql.includes("from report_history_meta"))return [{starts_at:"2026-10-01T00:00:00Z"}] as T[];return [];},transaction:<T>(fn:(exec:import("../../db/client.ts").DbExecutor)=>Promise<T>)=>fn(db),close:async()=>{}};return {deps:{db} as RegistryDeps,queries};}
it("область отклоняется до SQL фактов; выбранный дом исключает безадресные обращения",async()=>{
 const h=fixture(),actor=makeTestActor("administrator",[B1]);await expect(reportScope(h.deps.db,actor,"requests",{building_ids:[B2]})).rejects.toMatchObject({code:"FORBIDDEN"});expect(h.queries.some(q=>q.sql.includes("report.requests"))).toBe(false);
 const selected=await reportScope(h.deps.db,actor,"requests",{building_ids:[B1]});expect(selected.include_addressless).toBe(false);expect((await reportScope(h.deps.db,actor,"requests",{})).include_addressless).toBe(true);
});
it("жалоба на себя и chairman-only не входят даже в счётчики/экспортные строки",()=>{
 const actor=makeTestActor("administrator",[B1]),row={id:"r",building_id:B1,state:"new",is_test:false,complaint_route:"chairman",complaint_subject_person_id:null};expect(requestReportAccess(actor,row)).toBe(false);expect(requestReportAccess(makeTestActor("chairman",[],{personId:"pers-1"}),{...row,complaint_subject_person_id:"pers-1"})).toBe(false);
});
it("без VS-6 финансовый источник явно недоступен, нулевые фиктивные показатели не выдаются",async()=>{
 const h=fixture();const result=await operationalReport(h.deps,makeTestActor("chairman",[],{personId:"pers-1"}),"payments",{from:"2026-10-01",to:"2026-11-01"});expect(result).toMatchObject({available:false,reason:"VS6_SOURCE_UNAVAILABLE"});expect(result).not.toHaveProperty("flows");
});

it("реальные строки и счётчики используют одну PDP-выборку, скрытое содержание не попадает в DTO",async()=>{
 const good={id:"good",number:"З-1",kind:"request",category_id:null,state:"new",is_test:false,building_id:B1,complaint_subject_person_id:null,complaint_route:"administrator",created_at:"2026-10-02T00:00:00Z",updated_at:"2026-10-02T00:00:00Z",open_at:"2026-10-02T00:00:00Z",closed_at:null,close_method:null,confirmation_version:0,rating:null,events:[{id:"1",at:"2026-10-02T00:00:00Z",kind:"state",from_state:null,to_state:"new",action:"created",confirmation_version:0}],timers:[],unassigned:true,unread:false,report_pending:false,description:"SECRET",phone:"+7000000000"};
 const h=fixture([good,{...good,id:"foreign",building_id:B2},{...good,id:"private",complaint_route:"chairman"},{...good,id:"test",is_test:true}]);
 const result=await operationalReport(h.deps,makeTestActor("administrator",[B1]),"requests",{from:"2026-10-01",to:"2026-11-01"});expect(result).toMatchObject({available:true,flows:{received:1},snapshot:{open:1},total:1});expect(JSON.stringify(result)).not.toMatch(/SECRET|7000000000|foreign|private/);
 const query=h.queries.find(q=>q.sql.includes("report.requests"))!;expect(query.sql.indexOf("complaint_subject_person_id is distinct")).toBeLessThan(query.sql.indexOf("limit 10001"));expect(query.p[3]).toEqual([B1]);
});

it("черновик, отправленный после as_of, не попадает в снимок и не ломает возраст",async()=>{
 const h=fixture([{id:"future",number:"З-2",state:"new",is_test:false,building_id:B1,complaint_route:"administrator",created_at:"2026-10-01T00:00:00Z",open_at:"2026-10-25T00:00:00Z",updated_at:"2026-10-25T00:00:00Z",events:[],timers:[]}]);
 const result=await operationalReport(h.deps,makeTestActor("administrator",[B1]),"requests",{from:"2026-10-01",to:"2026-11-01"});expect(result).toMatchObject({total:0,snapshot:{open:0}});
});
it("загрузка относится к исполнителю на as_of, текущий исполнитель используется только для PDP",async()=>{
 const actor=makeTestActor("administrator",[B1]),h=fixture([{id:"task",number:"ЗД-1",title:"Двор",state:"accepted",observed_state:"in_progress",is_test:false,assignee_person_id:"new-worker",observed_assignee_person_id:"old-worker",assignee_name:"Прежний",assignee_known:true,deadline_known:true,building_ids:[B1],created_at:"2026-10-01T00:00:00Z",due_at:"2026-10-26T00:00:00Z",accepted_at:null,visits:1,reworks:0}]);
 const result=await operationalReport(h.deps,actor,"tasks",{from:"2026-10-01",to:"2026-11-01"});expect(result).toMatchObject({total:1,workload:[{person_id:"old-worker",name:"Прежний",open:1}]});expect(JSON.stringify(result)).not.toContain("new-worker");
 const query=h.queries.find(q=>q.sql.includes("report.tasks"))!;expect(query.sql).toContain("s.observed_assignee_person_id=$7");
});
