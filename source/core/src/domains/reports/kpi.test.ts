import { expect,it } from "vitest";
import { kpiSnapshot } from "./kpi.ts";
import { makeTestActor } from "../../testing/actors.ts";
import type { DbExecutor } from "../../db/client.ts";
it("реальные KPI не открываются исполнителю и тестовой персоне",async()=>{
 const exec:DbExecutor={async query(){throw new Error("should not query");}};expect(await kpiSnapshot(exec,makeTestActor("executor",[]),"2026-10-24T00:00:00Z")).toMatchObject({available:false});expect(await kpiSnapshot(exec,makeTestActor("chairman",[],{isTest:true}),"2026-10-24T00:00:00Z")).toMatchObject({available:false,reason:"TEST_SET"});
});
it("дата общего запуска должна быть задана явно",async()=>{
 const exec:DbExecutor={async query(){return [];}};expect(await kpiSnapshot(exec,makeTestActor("chairman",[]),"2026-10-24T00:00:00Z")).toEqual({available:true,configured:false});
});
it("KPI возвращает цели, размер наблюдаемой выборки и датированное достижение без персонального состава",async()=>{
 const exec:DbExecutor={async query<T>(sql:string):Promise<T[]>{return (sql.startsWith("select l.id")?[{id:"launch",launched_on:"2026-10-01",achieved_at:"2026-10-10T00:00:00Z",people_count:100}]:sql.includes("with latest")?[{n:101}]:[{n:31,unknown:2}]) as T[];}};
 const result=await kpiSnapshot(exec,makeTestActor("chairman",[]),"2026-10-24T00:00:00Z");expect(result).toMatchObject({configured:true,kpi_01:{target:100,people:101,achieved_at:"2026-10-10T00:00:00Z"},kpi_02:{target:30,requests:31,unknown:2}});expect(result).not.toHaveProperty("person_ids");
});
