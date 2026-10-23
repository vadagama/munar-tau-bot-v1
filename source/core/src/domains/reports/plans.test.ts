import { expect,it } from "vitest";
import { publishedPlans } from "./plans.ts";
import { B1,B2,makeTestActor } from "../../testing/actors.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { DbExecutor } from "../../db/client.ts";
it("205 чужих/неподходящих публикаций не скрывают более старую разрешённую работу",async()=>{
 const rows=Array.from({length:205},(_,i)=>({id:`hidden-${i}`,title:"Чужая",state:"published",kind:"announcement",building_ids:[B2],member:false,is_test:false}));rows.push({id:"allowed",title:"Работа",state:"published",kind:"work_report",building_ids:[B1],member:true,is_test:false});
 const queries:string[]=[];const db={async query<T>(sql:string):Promise<T[]>{queries.push(sql);if(!sql.includes("/* report.plans */"))return [];
 // SQL-имитация страницы: условия аудитории и вида обязаны предшествовать LIMIT.
 expect(sql.indexOf("p.kind='work_report'")).toBeLessThan(sql.indexOf("limit 11"));expect(sql.indexOf("membership.member")).toBeLessThan(sql.indexOf("limit 11"));expect(sql).not.toContain("limit 200");
 return rows.filter(r=>r.kind==="work_report"&&r.member).slice(0,11) as T[];
 },transaction:<T>(fn:(e:DbExecutor)=>Promise<T>)=>fn(db)};
 const result=await publishedPlans({db} as RegistryDeps,{...makeTestActor("executor",[]),assignments:[]},0);expect(result).toMatchObject({items:[{id:"allowed",title:"Работа"}],has_more:false});expect(result.items[0]).not.toHaveProperty("member");expect(queries.some(s=>s.includes("publication_scope"))).toBe(true);
});
