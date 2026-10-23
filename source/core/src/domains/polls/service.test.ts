import { expect, it } from "vitest";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { AuditEntryInput } from "../audit/port.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";
import { answerPoll, getPoll, openPoll, savePoll } from "./service.ts";

const pollId="10000000-0000-4000-8000-000000000001";
const personId="20000000-0000-4000-8000-000000000001";
const actor=makeTestActor("administrator",[B1],{personId});
const t=Date.parse("2026-10-23T10:00:00Z")*1000;
const body={question:"Когда?",options:[{key:"private_sat",label:"Суббота"},{key:"private_sun",label:"Воскресенье"}],building_ids:[B1],closes_at:"2026-11-01T10:00:00Z",reason:"Согласуем день"};
type R=Record<string,unknown>;
function harness(member=true) {
  const s:{now:number;poll:R|null;answer:R|null;events:R[];logs:R[];audit:AuditEntryInput[];keys:Map<string,R>}={now:t,poll:null,answer:null,events:member?[{id:"1",connection_id:"link",person_id:personId,building_id:B1,is_test:false,enabled:true,effective_at:String(t-1000000),valid_from:null,valid_until:null}]:[],logs:[],audit:[],keys:new Map()};
  const exec:DbExecutor={async query<T>(sql:string,params:readonly unknown[]=[]):Promise<T[]> {
    let rows:unknown[]=[];
    if(sql.startsWith("select public.audience_clock") || sql.startsWith("select pg_advisory"))rows=[];
    else if(sql.startsWith("with clock"))rows=[{at:new Date(s.now/1000),us:String(s.now)}];
    else if(sql.includes("from audience_history_meta"))rows=[{starts_at:String(t-2000000),starts_us:String(t-2000000)}];
    else if(sql.includes("from audience_connection_event e"))rows=s.events;
    else if(sql.startsWith("select request_hash,response"))rows=s.keys.has(String(params[0]))?[s.keys.get(String(params[0]))]:[];
    else if(sql.startsWith("insert into idempotency_key"))s.keys.set(String(params[0]),{request_hash:params[2],response:JSON.parse(String(params[3]))});
    else if(sql.startsWith("select id from building"))rows=[{id:B1}];
    else if(sql.startsWith("select p.*"))rows=s.poll?[{...s.poll}]:[];
    else if(sql.startsWith("insert into poll(")){
      s.poll={id:pollId,question:params[0],options:JSON.parse(String(params[1])),building_ids:params[2],closes_at:params[3],closes_us:String(Date.parse(String(params[3]))*1000),is_test:false,state:"draft",version:1,cancel_reason:null};rows=[{...s.poll}];
    }else if(sql.startsWith("update poll set state='open'")){
      s.poll={...s.poll,state:"open",version:Number(s.poll!.version)+1};rows=[{...s.poll}];
    }else if(sql.startsWith("update poll set question")){
      s.poll={...s.poll,question:params[0],options:JSON.parse(String(params[1])),building_ids:params[2],closes_at:params[3],version:Number(s.poll!.version)+1};rows=[{...s.poll}];
    }else if(sql.startsWith("select 1 from poll_answer"))rows=s.answer?[{exists:true}]:[];
    else if(sql.startsWith("select option_key,version,answered_at"))rows=s.answer?[{...s.answer}]:[];
    else if(sql.startsWith("insert into poll_answer(")){
      s.answer={option_key:params[2],version:Number(s.answer?.version??0)+1,answered_at:new Date(s.now/1000),answered_us:String(s.now)};rows=[{...s.answer}];
    }else if(sql.startsWith("insert into poll_answer_log"))s.logs.push({sql,params:[...params]});
    else throw new Error(`Неожиданный SQL: ${sql}`);
    return rows as T[];
  }};
  const db:DbClient={...exec,async transaction(fn){
    const snapshot=structuredClone(s);
    try{return await fn(exec);}catch(error){Object.assign(s,snapshot);throw error;}
  },async close(){}};
  const deps:RegistryDeps={db,audit:{async append(_exec,input){s.audit.push(input);return {...input,id:1,at:new Date().toISOString()};},async list(){throw new Error("unused");}}};
  const opened=async()=>{
    await savePoll(deps,actor,null,body,"create");
    return openPoll(deps,actor,pollId,{expected_version:1,reason:"Открываем"},"open");
  };
  return {s,deps,opened};
}
it("после открытия параметры неизменны; версия черновика защищает устаревшую форму",async()=>{
  const h=harness();await savePoll(h.deps,actor,null,body,"create");
  await expect(savePoll(h.deps,actor,pollId,{question:"Другое",reason:"Правка",expected_version:0},"old")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  await openPoll(h.deps,actor,pollId,{expected_version:1,reason:"Открываем"},"open");
  await expect(savePoll(h.deps,actor,pollId,{question:"Другое",reason:"Правка",expected_version:2},"edit")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.poll?.question).toBe(body.question);
});
it("изменяет один личный ответ, повтор ключа не создаёт новый; выбор не попадает в общий аудит",async()=>{
  const h=harness();await h.opened();
  const first=await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  expect(await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote")).toEqual(JSON.parse(JSON.stringify(first)));
  await expect(answerPoll(h.deps,actor,pollId,{option_key:"private_sun",expected_version:0},"oldvote")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  const updated=await answerPoll(h.deps,actor,pollId,{option_key:"private_sun",expected_version:1},"change");
  expect(updated.version).toBe(2);expect(h.s.logs).toHaveLength(2);
  expect(JSON.stringify(h.s.audit)).not.toContain("private_sat");expect(JSON.stringify(h.s.audit)).not.toContain("private_sun");
});
it("потеря и восстановление последней связи исключает прежний ответ, новый фиксирует повторное участие",async()=>{
  const h=harness();await h.opened();await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  const initial=h.s.events[0]!;
  h.s.events.push({...initial,id:"2",enabled:false,effective_at:String(t+1000)},{...initial,id:"3",effective_at:String(t+2000)});
  h.s.now=t+3000;
  expect((await getPoll(h.deps,actor,pollId)).own_answer?.included).toBe(false);
  await answerPoll(h.deps,actor,pollId,{option_key:"private_sun",expected_version:1},"rejoin");
  expect(h.s.logs.filter(row=>String(row.sql).includes("'excluded'"))).toHaveLength(1);
  expect((await getPoll(h.deps,actor,pollId)).own_answer?.included).toBe(true);
});
it("точно на сроке ответ закрыт без ожидания jobs",async()=>{
  const h=harness();await h.opened();h.s.now=Number(h.s.poll!.closes_us);
  await expect(answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"late")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.answer).toBeNull();
});
it("управляющий без действующей связи не голосует и не получает чужие персональные ответы",async()=>{
  const h=harness(false);await h.opened();
  await expect(answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote")).rejects.toMatchObject({code:"NOT_FOUND"});
  const card=await getPoll(h.deps,actor,pollId);expect(card.can_manage).toBe(true);expect(card.can_answer).toBe(false);expect(card.own_answer).toBeNull();
});
