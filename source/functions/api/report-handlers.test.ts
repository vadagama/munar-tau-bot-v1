import { assertEquals,assertThrows,assertRejects } from "@std/assert";
import { REPORT_ROUTES,aggregateFilters,reportFilters } from "./report-handlers.ts";
import { matchRoute,type RouteContext } from "./handlers.ts";
import { makeTestActor } from "../../core/src/testing/actors.ts";
import { ApiError } from "../../core/src/errors/api.ts";
Deno.test("REP: все одиннадцать маршрутов используют эффективную персону и собственный PDP",()=>{
 assertEquals(REPORT_ROUTES.length,11);for(const r of REPORT_ROUTES){assertEquals(r.evaluateAs,"effective");assertEquals(r.action.startsWith("report."),true);assertEquals(matchRoute(r.method,r.path.replace(":id",crypto.randomUUID()))?.route.path,r.path);}
});
Deno.test("REP: URL-фильтры типизированы, неизвестные и повторные отклоняются",()=>{
 assertEquals(reportFilters(new URL("https://test/v1/reports/tasks?from=2026-10-01&to=2026-11-01&building_ids=a,b&offset=10&forceFunctionRegion=ap-southeast-2")),{from:"2026-10-01",to:"2026-11-01",building_ids:["a","b"],offset:10});
 assertThrows(()=>reportFilters(new URL("https://test/?secret=x")),ApiError);assertThrows(()=>reportFilters(new URL("https://test/?from=a&from=b")),ApiError);
});
Deno.test("REP: агрегаты (S4a.1) читают отчётные права, фильтры — период, дом и исполнитель",()=>{
 assertEquals(REPORT_ROUTES.filter(r=>r.path.endsWith("-by-assignee")||r.path.endsWith("-by-day")||r.path.endsWith("-by-building")).length,3);
 for(const path of ["/v1/reports/workload-by-assignee","/v1/reports/created-closed-by-day","/v1/reports/overdue-by-building"]){
  const route=REPORT_ROUTES.find(r=>r.path===path)!;assertEquals(route.method,"GET");assertEquals(route.evaluateAs,"effective");
  assertEquals(matchRoute("GET",path)?.route.path,path);
 }
 assertEquals(aggregateFilters(new URL("https://test/v1/reports/workload-by-assignee?from=2026-10-01&to=2026-10-05&building_ids=a,b&assignee_id=c&forceFunctionRegion=ap-southeast-2")),{from:"2026-10-01",to:"2026-10-05",building_ids:["a","b"],assignee_id:"c"});
 assertThrows(()=>aggregateFilters(new URL("https://test/?state=new")),ApiError);assertThrows(()=>aggregateFilters(new URL("https://test/?from=a&from=b")),ApiError);
});
Deno.test("REP: источник и права проверяются без запросов к чужим данным",async()=>{
 const route=REPORT_ROUTES.find(r=>r.path==="/v1/reports/requests")!;
 await assertRejects(()=>route.handler({actor:makeTestActor("executor",[]),url:new URL("https://test/?from=2026-10-01&to=2026-11-01"),deps:{}} as RouteContext),ApiError);
});
