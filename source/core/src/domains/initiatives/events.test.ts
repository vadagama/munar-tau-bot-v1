import { enqueueInitiativeReview } from "./events.ts";
import type { DbExecutor } from "../../db/client.ts";
import { expect,it } from "vitest";
import { fixture,id } from "./service.test-support.ts";
import { transitionInitiative } from "./service.ts";
import { initiativeNoticeAllowed } from "./notices.ts";
import { B1,makeTestActor } from "../../testing/actors.ts";
it("решение и персональный outbox сохраняются вместе; конфликт не создаёт уведомления",async()=>{
 const h=fixture();await h.submit();await transitionInitiative(h.deps,h.actor,id,"publish",{expected_version:1,reason:"Проверено",building_ids:[B1]},"publish");
 expect(h.s.outbox).toHaveLength(1);expect(h.s.outbox[0]).toMatchObject({initiativeId:id,initiativeReview:false,personId:h.actor.person.id,template:"notices.initiatives.state.collecting"});
 await expect(transitionInitiative(h.deps,h.actor,id,"assessing",{expected_version:1,reason:"Старая версия"},"stale")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});expect(h.s.outbox).toHaveLength(1);
});
it("доставка повторяет PDP: неопубликованное — автору/управляющему, после потери аудитории опубликованное не доставляется",async()=>{
 const h=fixture();await h.submit();const resident=makeTestActor("executor",[B1],{personId:h.actor.person.id});resident.assignments=[];
 expect(await initiativeNoticeAllowed(h.deps.db,resident,id)).toBe(true);expect(await initiativeNoticeAllowed(h.deps.db,resident,id,true)).toBe(false);
 await transitionInitiative(h.deps,h.actor,id,"publish",{expected_version:1,reason:"Проверено",building_ids:[B1]},"publish");
 expect(await initiativeNoticeAllowed(h.deps.db,resident,id)).toBe(true);h.s.members=[];
 expect(await initiativeNoticeAllowed(h.deps.db,resident,id)).toBe(false);expect(await initiativeNoticeAllowed(h.deps.db,h.actor,id,true)).toBe(true);
 expect(await initiativeNoticeAllowed(h.deps.db,makeTestActor("chairman",[],{isTest:true}),id,true)).toBe(false);
});

it("служебное рассмотрение направляется в worker, персональное решение автора остаётся resident",async()=>{
 const h=fixture();await h.submit();let queued:Record<string,unknown>[]=[];
 const exec:DbExecutor={async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{if(sql.startsWith("select distinct p.id"))return [{id:"manager"}] as T[];if(sql.startsWith("insert into outbox"))queued=JSON.parse(String(p[0]));return [];}};
 await enqueueInitiativeReview(exec,h.s.row!);expect(queued).toHaveLength(1);expect(queued[0]).toMatchObject({bot:"worker",initiativeReview:true});
 await transitionInitiative(h.deps,h.actor,id,"reject",{expected_version:1,reason:"Отказ"},"reject");expect(h.s.outbox[0]).toMatchObject({bot:"resident",initiativeReview:false});
});
