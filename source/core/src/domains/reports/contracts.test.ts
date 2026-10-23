import { expect,it } from "vitest";
import { reportPeriod,kpiPeriod,summarizeRequests,kpiPeople,kpiRequests } from "./contracts.ts";
const period={...reportPeriod("2026-10-01","2026-11-01"),as_of:"2026-10-25T00:00:00Z"};
it("границы Алматы полуоткрыты; три месяца с конца месяца не превращаются в 90 дней",()=>{
 expect(reportPeriod("2026-10-01","2026-11-01")).toEqual({from:"2026-09-30T19:00:00.000Z",to:"2026-10-31T19:00:00.000Z",timezone:"Asia/Almaty"});
 expect(kpiPeriod("2026-01-31")?.to).toBe("2026-04-29T19:00:00.000Z");expect(kpiPeriod("2026-11-30")?.to).toBe("2027-02-27T19:00:00.000Z");expect(kpiPeriod(null)).toBeNull();
 expect(()=>reportPeriod("2026-02-30","2026-03-01")).toThrow();expect(()=>reportPeriod("2026-10-02","2026-10-01")).toThrow();
});
const facts=[
 {id:"old",created_at:"2026-09-01T00:00:00Z",registered_at:"2026-09-01T00:00:00Z",final_closed_at:"2026-10-03T00:00:00Z",state_at_as_of:"closed",close_method:"author",rating:5,response_history_complete:true,first_response_at:"2026-09-01T00:20:00Z",first_response_working_minutes:10,overdue:false,rework_at:[],is_test:false,is_pilot:false},
 {id:"open",created_at:"2026-10-02T00:00:00Z",registered_at:"2026-10-02T00:00:00Z",final_closed_at:null,state_at_as_of:"rework",close_method:null,rating:null,response_history_complete:true,first_response_at:"2026-10-02T00:30:00Z",first_response_working_minutes:15,overdue:true,rework_at:["2026-10-04T00:00:00Z","2026-10-05T00:00:00Z"],is_test:false,is_pilot:false},
 {id:"admin",created_at:"2026-10-01T00:00:00Z",registered_at:"2026-10-01T00:00:00Z",final_closed_at:"2026-10-04T00:00:00Z",state_at_as_of:"closed",close_method:"administrative",rating:4,response_history_complete:true,first_response_at:null,first_response_working_minutes:null,overdue:false,rework_at:[],is_test:false,is_pilot:false},
];
it("поток/срез различаются, RAT-04 только авторские финальные закрытия, возвраты событиями и обращениями",()=>{
 const result=summarizeRequests(facts,period,false);expect(result.flows).toMatchObject({received:2,completed:2,author_confirmed:1,admin_closed:1,returns:2,returned_requests:1});expect(result.snapshot).toMatchObject({open:1,overdue:1});
 expect(result.durations.first_response.calendar).toEqual({mean:30,median:30,n:1});expect(result.sample_sizes).toMatchObject({registered:2,without_response:1});expect(result.rating).toEqual({mean:5,rated:1,author_closed:1,response_percent:100});
 expect(summarizeRequests([],period,false).rating.response_percent).toBeNull();expect(summarizeRequests([...facts,{...facts[0]!,id:"test",is_test:true}],period,false)).toEqual(result);
});
it("KPI-01 дедуплицирует помещения и роли, включает пилот и нежилые связи; KPI-02 исключает пилот/тест/админзакрытие",()=>{
 expect(kpiPeople([{person_id:"staff-resident",confirmed:true,active_connection:true,is_test:false},{person_id:"staff-resident",confirmed:true,active_connection:true,is_test:false},{person_id:"service",confirmed:true,active_connection:false,is_test:false},{person_id:"test",confirmed:true,active_connection:true,is_test:true},{person_id:"owner-parking",confirmed:true,active_connection:true,is_test:false}])).toBe(2);
 const kpi=kpiPeriod("2026-10-01")!;expect(kpiRequests([...facts,{...facts[0]!,id:"good",created_at:"2026-10-01T00:00:00Z",registered_at:"2026-10-01T00:00:00Z"},{...facts[0]!,id:"pilot",registered_at:"2026-10-01T00:00:00Z",is_pilot:true}],kpi)).toBe(1);
});
it("будущие закрытия и ответы не попадают в срез; полная история обязательна для открыто/просрочено",()=>{
 const row={...facts[1]!,response_history_complete:true,first_response_at:"2026-10-30T00:00:00Z",final_closed_at:"2026-10-30T00:00:00Z",state_at_as_of:null};const result=summarizeRequests([row],period,false);expect(result.flows.completed).toBe(0);expect(result.snapshot).toEqual({open:0,overdue:0,unknown:1});expect(result.sample_sizes.without_response).toBe(1);
});

it("неизвестная история первого ответа не попадает в число неответивших",()=>{
 const result=summarizeRequests([{...facts[1]!,response_history_complete:false}],period,false);expect(result.sample_sizes).toMatchObject({without_response:0,unknown_response:1,with_response:0});
});

it("срез потока не округляет микросекунды к as_of",()=>{
 const row={...facts[0]!,created_at:"2026-10-01T00:00:00Z",registered_at:"2026-10-01T00:00:00Z",first_response_at:null,final_closed_at:"2026-10-23T10:00:00.000200Z"};
 expect(summarizeRequests([row],{...period,as_of:"2026-10-23T10:00:00.000500Z"},false).flows.completed).toBe(1);
});
