import { expect,it } from "vitest";
import type { DbClient } from "../../db/client.ts";
import { B1,B2,makeTestActor } from "../../testing/actors.ts";
import { listPolls } from "./list.ts";
const visible={id:"visible",question:"Вопрос",options:[{key:"yes",label:"Да"},{key:"no",label:"Нет"}],building_ids:[B1],closes_at:"2026-11-01T10:00:00Z",closes_us:"1793527200000000",now_us:"1792759200000000",is_test:false,state:"open",version:2,cancel_reason:null,is_member:true,participated:false,final_participant:false};
it("PDP применяется до пагинации; список не содержит чужих ответов и участников",async()=>{
  const hidden=Array.from({length:25},(_,i)=>({...visible,id:`hidden-${i}`,building_ids:[B2],is_member:false}));
  const db={query:async()=>[...hidden,visible,{...visible,id:"second"}],transaction:async(fn:(exec:unknown)=>unknown)=>fn(db),close:async()=>{}} as unknown as DbClient;
  const deps={db,audit:{append:async()=>{throw new Error("unused");},list:async()=>{throw new Error("unused");}}};
  const actor=makeTestActor("executor",[B2]);
  const first=await listPolls(deps,actor,{offset:0,limit:1});
  expect(first.items.map(row=>row.id)).toEqual(["visible"]);expect(first.has_more).toBe(true);
  expect((await listPolls(deps,actor,{offset:1,limit:1})).items.map(row=>row.id)).toEqual(["second"]);
  expect(JSON.stringify(first)).not.toContain("person_id");expect(JSON.stringify(first)).not.toContain("option_key");
});
it("отклоняет неверную страницу и состояние до чтения",async()=>{
  const db={query:async()=>{throw new Error("SQL не должен вызываться");}} as unknown as DbClient;
  const deps={db,audit:{append:async()=>{throw new Error("unused");},list:async()=>{throw new Error("unused");}}};
  const actor=makeTestActor("chairman",[]);
  for(const options of [{offset:-1},{limit:0},{limit:51},{state:"missing"}])await expect(listPolls(deps,actor,options)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
});
