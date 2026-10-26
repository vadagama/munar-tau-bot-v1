import type { Route,RouteContext } from "./handlers.ts";
import { operationalReport } from "../../core/src/domains/reports/service.ts";
import { createdClosedByDay,overdueByBuilding,workloadByAssignee } from "../../core/src/domains/reports/aggregates.ts";
import { configureReportLaunch } from "../../core/src/domains/reports/config.ts";
import { createReportExport,getReportExport,reportExportUrl } from "../../core/src/domains/reports/export.ts";
import { databaseValidation,invalid } from "../../core/src/domains/registry/validation.ts";
import { initiativeUuid } from "../../core/src/domains/initiatives/input.ts";
const deps=(c:RouteContext)=>({db:c.deps.db,audit:c.deps.audit});
export function reportFilters(url:URL){
 const values:Record<string,unknown>={};
 for(const [key,value] of url.searchParams){if(key==="forceFunctionRegion")continue;if(!["from","to","building_ids","assignee_id","state","offset","limit"].includes(key))invalid("Неизвестный фильтр отчёта");if(key in values)invalid("Повторный фильтр отчёта");values[key]=key==="building_ids"?value.split(","):key==="offset"||key==="limit"?Number(value):value;}
 return values;
}
/** Фильтры агрегатов (S4a.1): период, дом/исполнитель — остальное отклоняется. */
export function aggregateFilters(url:URL){
 const values:Record<string,unknown>={};
 for(const [key,value] of url.searchParams){if(key==="forceFunctionRegion")continue;if(!["from","to","building_ids","assignee_id"].includes(key))invalid("Неизвестный фильтр отчёта");if(key in values)invalid("Повторный фильтр отчёта");values[key]=key==="building_ids"?value.split(","):value;}
 return values;
}
function route(method:Route["method"],path:string,action:Route["action"],handler:Route["handler"]):Route{return {method,path,action,evaluateAs:"effective",handler:c=>databaseValidation(()=>handler(c))};}
export const REPORT_ROUTES:Route[]=[
 ...(["requests","tasks","incidents","payments"] as const).map(kind=>route("GET",`/v1/reports/${kind}`,`report.${kind}`,async c=>({body:await operationalReport(deps(c),c.actor,kind,reportFilters(c.url))}))),
 route("GET","/v1/reports/workload-by-assignee","report.tasks",async c=>({body:await workloadByAssignee(deps(c),c.actor,aggregateFilters(c.url))})),
 route("GET","/v1/reports/created-closed-by-day","report.requests",async c=>({body:await createdClosedByDay(deps(c),c.actor,aggregateFilters(c.url))})),
 route("GET","/v1/reports/overdue-by-building","report.requests",async c=>({body:await overdueByBuilding(deps(c),c.actor,aggregateFilters(c.url))})),
 route("POST","/v1/reports/export","report.export",async c=>({status:202,body:await createReportExport(deps(c),c.actor,c.body,c.request.headers.get("idempotency-key"))})),
 route("GET","/v1/reports/exports/:id","report.export",async c=>({body:await getReportExport(deps(c),c.actor,initiativeUuid(c.params.id,"экспорт"))})),
 route("GET","/v1/reports/exports/:id/url","report.export",async c=>{if(!c.deps.storage)invalid("Хранилище недоступно");return {body:await reportExportUrl(deps(c),c.deps.storage,c.actor,initiativeUuid(c.params.id,"экспорт"))};}),
 route("POST","/v1/reports/launch","report.configure",async c=>({status:201,body:await configureReportLaunch(deps(c),c.actor,c.body,c.request.headers.get("idempotency-key"))})),
];
