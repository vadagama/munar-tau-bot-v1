import { beforeEach,expect,it,vi } from "vitest";
import { reportStep } from "./reports.ts";
import { operationalReport } from "../domains/reports/service.ts";
import { publishedPlans } from "../domains/reports/plans.ts";
import { replyText,type BotReply } from "./keyboard.ts";
import { makeTestActor,B1 } from "../testing/actors.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
vi.mock("./registration.ts",()=>({actorForTelegram:vi.fn()}));
vi.mock("../domains/reports/service.ts",()=>({operationalReport:vi.fn()}));
vi.mock("../domains/reports/plans.ts",()=>({publishedPlans:vi.fn()}));
const fixture=(bot:"resident"|"worker")=>({bot,db:{query:vi.fn(async()=>[])}} as unknown as RegistryDeps);
const buttons=(r:BotReply)=>typeof r==="string"?[]:r.buttons?.flat()??[];
beforeEach(()=>{vi.clearAllMocks();vi.mocked(operationalReport).mockResolvedValue({available:true,as_of:"2026-10-24T00:00:00Z",snapshot:{open:2,overdue:1,unknown:0},flows:{completed:1},operational:{awaiting_acceptance:1,on_review:0},items:[{id:"10000000-0000-4000-8000-000000000001",number:"ЗД-42",title:"<b>Двор</b>"}],has_more:false} as never);vi.mocked(publishedPlans).mockResolvedValue({items:[{id:"10000000-0000-4000-8000-000000000001",kind:"work_report",title:"Двор"}],has_more:false} as never);});
for(const language of ["ru","kk"] as const)it(`сотрудник ${language}: личный фильтр даже для председателя, ссылки без ряда кнопок`,async()=>{
 const a=makeTestActor("chairman",[]),actor={...a,profile:{...a.profile,language}},d=fixture("worker"),reply=await reportStep(d,"1","/mywork",actor);
 expect(operationalReport).toHaveBeenCalledWith(d,actor,"tasks",expect.objectContaining({assignee_id:actor.person.id,limit:10,offset:0}));expect(replyText(reply)).toContain("&lt;b&gt;Двор&lt;/b&gt;");expect(replyText(reply)).toContain("?start=wrk_");expect(buttons(reply).some(b=>b.data.startsWith("/task "))).toBe(false);expect(buttons(reply).every(b=>new TextEncoder().encode(b.data).length<=64)).toBe(true);
});
it("житель не получает управленческие показатели через команду сотрудника",async()=>{
 await expect(reportStep(fixture("resident"),"1","/mywork",makeTestActor("executor",[B1]))).rejects.toMatchObject({code:"FORBIDDEN"});expect(operationalReport).not.toHaveBeenCalled();
});
it("планы жителя используют только опубликованные разрешённые публикации",async()=>{
 const d=fixture("resident"),actor=makeTestActor("executor",[B1]),r=await reportStep(d,"1","/plans",actor);expect(publishedPlans).toHaveBeenCalledWith(d,actor,0);expect(replyText(r)).not.toContain("SECRET");expect(buttons(r).some(b=>b.data.startsWith("/publication "))).toBe(true);expect(operationalReport).not.toHaveBeenCalled();
});
it("пагинация и чужие команды проверяются до чтения источника",async()=>{
 const d=fixture("worker"),actor=makeTestActor("executor",[B1]);for(const input of ["/mywork -1","/mywork 1.5","/mywork 10001","/reports","/plans 1 extra"])await expect(reportStep(d,"1",input,actor)).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(operationalReport).not.toHaveBeenCalled();expect(publishedPlans).not.toHaveBeenCalled();
});
