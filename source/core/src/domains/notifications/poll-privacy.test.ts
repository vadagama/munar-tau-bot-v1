import { expect,it,vi } from "vitest";
import type { DbExecutor,DbClient } from "../../db/client.ts";
import { makeTestActor } from "../../testing/actors.ts";
import { completeFollowup,listFailures } from "./followup.ts";
const chairman=makeTestActor("chairman",[],{isTest:true});
it.each([{pollId:"poll",pollEvent:"closed"},{moderationActionId:"action"}])("персональные POL/MOD данные скрыты в ошибках доставки и прямом followup UUID (%j)",async event_ref=>{
  const privateRow={id:"notice",recipient_person_id:"resident",is_test:true,event_ref,followup_state:"open"};
  let personReads=0,writes=0;
  const exec:DbExecutor={async query<T>(sql:string){
    if(sql.startsWith("select full_name")){personReads++;return [{full_name:"Имя",phone_e164:"+7"}] as T[];}
    if(sql.startsWith("select n."))return [privateRow] as T[];
    if(sql.startsWith("update"))writes++;
    return [];
  }};
  expect((await listFailures(exec,chairman)).items).toEqual([]);
  const db:DbClient={...exec,transaction:fn=>fn(exec),async close(){}};
  await expect(completeFollowup({db,audit:{append:vi.fn(),list:vi.fn()}},chairman,"followup","Позвонили")).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(personReads).toBe(0);expect(writes).toBe(0);
});
it("старое событие без ref также скрыто по устойчивому ключу POL",async()=>{
  const row={id:"notice",is_test:true,dedup_key:"poll.canceled:poll:resident",event_ref:{},followup_state:"open"};
  const exec:DbExecutor={async query<T>(){return [row] as T[];}};
  const db:DbClient={...exec,transaction:fn=>fn(exec),async close(){}};
  await expect(completeFollowup({db,audit:{append:vi.fn(),list:vi.fn()}},chairman,"known","Попытка")).rejects.toMatchObject({code:"NOT_FOUND"});
});
