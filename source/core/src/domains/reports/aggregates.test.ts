import { expect,it } from "vitest";
import { createdClosedByDay,overdueByBuilding,workloadByAssignee } from "./aggregates.ts";
import { makeTestActor,B1,B2 } from "../../testing/actors.ts";
import type { DbClient } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
const AS_OF="2026-10-26T10:00:00.000500Z";
function fixture(rows:Row[]=[]){const queries:{sql:string;p:readonly unknown[]}[]=[];const db:DbClient={async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{queries.push({sql,p});if(sql.startsWith("select clock_timestamp"))return [{at:AS_OF}] as T[];if(sql.startsWith("select id,coalesce(name"))return [{id:B1},{id:B2}] as T[];return rows as T[];},transaction:<T>(fn:(exec:import("../../db/client.ts").DbExecutor)=>Promise<T>)=>fn(db),close:async()=>{}};return {deps:{db} as RegistryDeps,queries};}

it("нагрузка: область PDP до группировки, параметры совпадают с queryTaskReport",async()=>{
 const h=fixture([{person_id:"w1",name:"Работник",open:3,overdue:1,on_review:1,rework:0,total_open:3}]);
 const result=await workloadByAssignee(h.deps,makeTestActor("chairman",[],{personId:"pers-1"}),{});
 expect(result).toMatchObject({kind:"workload_by_assignee",as_of:AS_OF,total:3,truncated:false,is_test:false,period:null});
 expect(result.rows).toEqual([{person_id:"w1",name:"Работник",open:3,overdue:1,on_review:1,rework:0}]);
 const query=h.queries.find(q=>q.sql.includes("report.tasks"))!;
 expect(query.sql).toContain("s.assignee_person_id=$2 and s.observed_assignee_person_id=$2");
 expect(query.sql).toContain("s.observed_assignee_person_id=$7");
 expect(query.sql).toContain("building_ids<@array(select jsonb_array_elements_text(a))::uuid[]");
 expect(query.sql.indexOf("where")).toBeLessThan(query.sql.indexOf("group by"));
 expect(query.p[0]).toBe(false);expect(query.p[1]).toBe("pers-1");expect(query.p[2]).toBe(true);
 expect(query.p[3]).toBe(AS_OF);expect(query.p[4]).toBe("[]");expect(query.p[5]).toBeNull();expect(query.p[6]).toBeNull();expect(query.p[7]).toBeNull();expect(query.p[8]).toBeNull();
});

it("нагрузка исполнителя: только свои задания, чужой исполнитель запрещён",async()=>{
 const h=fixture([{person_id:"e1",name:null,open:1,overdue:0,on_review:0,rework:0,total_open:1}]);
 const actor=makeTestActor("executor",[],{personId:"pers-9"});
 const result=await workloadByAssignee(h.deps,actor,{});
 	expect((result.rows as Row[])[0]).toMatchObject({person_id:"e1",name:null,open:1});
 const query=h.queries.find(q=>q.sql.includes("report.tasks"))!;
 expect(query.p[0]).toBe(false);expect(query.p[2]).toBe(false);
 await expect(workloadByAssignee(h.deps,actor,{assignee_id:"99999999-9999-4999-8999-999999999999"})).rejects.toMatchObject({code:"FORBIDDEN"});
});

it("нагрузка: период фильтрует created_at с границами 05:00 Алматы",async()=>{
 const h=fixture();
 await workloadByAssignee(h.deps,makeTestActor("chairman",[],{personId:"p"}),{from:"2026-10-24",to:"2026-10-26"});
 const query=h.queries.find(q=>q.sql.includes("report.tasks"))!;
 expect(query.p[7]).toBe("2026-10-24T00:00:00.000Z");
 expect(query.p[8]).toBe("2026-10-27T00:00:00.000Z");
 expect(query.sql).toContain("t.created_at>=$8::timestamptz");
 expect(query.sql).toContain("t.created_at<$9::timestamptz");
 const result=await workloadByAssignee(h.deps,makeTestActor("chairman",[],{personId:"p"}),{from:"2026-10-24",to:"2026-10-26"});
 expect(result.period).toEqual({from:"2026-10-24",to:"2026-10-26",timezone:"Asia/Almaty"});
});

it("нагрузка: усечение до 50 исполнителей, итог по всем группам из окна SQL",async()=>{
 const rows=Array.from({length:51},(_,i)=>({person_id:`p${i}`,name:`Работник ${i}`,open:1,overdue:0,on_review:0,rework:0,total_open:60}));
 const h=fixture(rows);
 const result=await workloadByAssignee(h.deps,makeTestActor("chairman",[],{personId:"p"}),{});
 expect(result.rows).toHaveLength(50);expect(result.truncated).toBe(true);expect(result.total).toBe(60);
});

it("нагрузка: тестовые данные изолируются флагом is_test",async()=>{
 const h=fixture([]);
 const result=await workloadByAssignee(h.deps,makeTestActor("chairman",[],{personId:"p",isTest:true}),{});
 expect(result.is_test).toBe(true);expect(result.rows).toEqual([]);expect(result.total).toBe(0);
});

it("создано/закрыто: бакеты по суткам 05:00→05:00, totals по бакетам, область запросов",async()=>{
 const h=fixture([{buckets:[{day:"2026-10-24",from:"2026-10-24T00:00:00Z",to:"2026-10-25T00:00:00Z",created:3,closed:1},{day:"2026-10-25",from:"2026-10-25T00:00:00Z",to:"2026-10-26T00:00:00Z",created:2,closed:0}]}]);
 const result=await createdClosedByDay(h.deps,makeTestActor("administrator",[B1]),{from:"2026-10-24",to:"2026-10-25"});
 expect(result).toMatchObject({kind:"created_closed_by_day",as_of:AS_OF,is_test:false,totals:{created:5,closed:1}});
 expect(result.period).toEqual({from:"2026-10-24T00:00:00.000Z",to:"2026-10-26T00:00:00.000Z",timezone:"Asia/Almaty"});
 expect(result.buckets).toHaveLength(2);
 const query=h.queries.find(q=>q.sql.includes("report.requests"))!;
 const buckets=JSON.parse(String(query.p[8])) as Array<{day:string;from:string;to:string}>;
 expect(buckets).toEqual([
  {day:"2026-10-24",from:"2026-10-24T00:00:00.000Z",to:"2026-10-25T00:00:00.000Z"},
  {day:"2026-10-25",from:"2026-10-25T00:00:00.000Z",to:"2026-10-26T00:00:00.000Z"}]);
 expect(query.sql).toContain("r.complaint_subject_person_id is distinct from $2::uuid");
 expect(query.sql).toContain("r.complaint_route<>'chairman'");
 expect(query.sql).toContain("v.created_at>=b.\"from\"");
 expect(query.p[0]).toBe(false);expect(query.p[3]).toEqual([B1]);expect(query.p[4]).toBeNull();expect(query.p[5]).toBe(true);
 expect(query.p[6]).toBe("2026-10-24T00:00:00.000Z");expect(query.p[7]).toBe("2026-10-26T00:00:00.000Z");
});

it("создано/закрыто: без периода — текущие сутки Алматы одним бакетом",async()=>{
 const h=fixture([{buckets:[]}]);
 const result=await createdClosedByDay(h.deps,makeTestActor("administrator",[B1]),{});
 expect(result.buckets).toEqual([]);
 const query=h.queries.find(q=>q.sql.includes("report.requests"))!;
 const buckets=JSON.parse(String(query.p[8])) as Array<{day:string;from:string;to:string}>;
 expect(buckets).toEqual([{day:"2026-10-26",from:"2026-10-26T00:00:00.000Z",to:"2026-10-27T00:00:00.000Z"}]);
});

it("создано/закрыто и просрочка: исполнитель без report.requests не читает агрегат",async()=>{
 const h=fixture([]);
 await expect(createdClosedByDay(h.deps,makeTestActor("executor",[]),{})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(overdueByBuilding(h.deps,makeTestActor("executor",[]),{})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(h.queries.some(q=>q.sql.includes("report.requests"))).toBe(false);
});

it("создано/закрыто: неизвестные фильтры и некорректный период отклоняются",async()=>{
 const h=fixture([]);
 const actor=makeTestActor("chairman",[],{personId:"p"});
 await expect(createdClosedByDay(h.deps,actor,{assignee_id:"99999999-9999-4999-8999-999999999999"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(createdClosedByDay(h.deps,actor,{from:"2026-10-24"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(createdClosedByDay(h.deps,actor,{from:"2026-10-26",to:"2026-10-20"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(createdClosedByDay(h.deps,actor,{from:"2026-01-01",to:"2026-04-03"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(createdClosedByDay(h.deps,actor,{from:"2026-01-01",to:"2026-04-02"})).resolves.toBeTruthy();
});

it("просрочка по домам: предикат CURRENT_OVERDUE с as_of, безадресные отдельной строкой",async()=>{
 const h=fixture([
  {building_id:B1,label:"Дом 1",open:5,overdue:2,total_overdue:2},
  {building_id:B2,label:"Дом 2",open:3,overdue:0,total_overdue:2},
  {building_id:null,label:null,open:1,overdue:0,total_overdue:2}]);
 const result=await overdueByBuilding(h.deps,makeTestActor("administrator",[B1]),{});
 expect(result).toMatchObject({kind:"overdue_by_building",as_of:AS_OF,total:2,truncated:false,is_test:false,period:null});
 expect(result.rows).toEqual([
  {building_id:B1,label:"Дом 1",open:5,overdue:2},
  {building_id:B2,label:"Дом 2",open:3,overdue:0},
  {building_id:null,label:null,open:1,overdue:0}]);
 const query=h.queries.find(q=>q.sql.includes("report.requests"))!;
 expect(query.sql).toContain("r.first_response_due_at<$5::timestamptz");
 expect(query.sql).toContain("r.due_at<$5::timestamptz");
 expect(query.p[4]).toBe(AS_OF);
 expect(query.sql.indexOf("where")).toBeLessThan(query.sql.indexOf("group by"));
});

it("просрочка по домам: период по created_at, усечение до 100 строк",async()=>{
 const rows=Array.from({length:101},(_,i)=>({building_id:`b${i}`,label:`Дом ${i}`,open:1,overdue:0,total_overdue:0}));
 const h=fixture(rows);
 const result=await overdueByBuilding(h.deps,makeTestActor("chairman",[],{personId:"p"}),{from:"2026-10-01",to:"2026-10-05"});
 expect(result.rows).toHaveLength(100);expect(result.truncated).toBe(true);
 const query=h.queries.find(q=>q.sql.includes("report.requests"))!;
 expect(query.p[4]).toBe(AS_OF);
 expect(query.p[7]).toBe("2026-10-01T00:00:00.000Z");expect(query.p[8]).toBe("2026-10-06T00:00:00.000Z");
 expect(query.sql).toContain("r.created_at>=$8::timestamptz");
 expect(result.period).toEqual({from:"2026-10-01",to:"2026-10-05",timezone:"Asia/Almaty"});
});
