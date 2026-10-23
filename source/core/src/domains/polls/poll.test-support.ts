import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { AuditEntryInput } from "../audit/port.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";
import { openPoll, savePoll } from "./service.ts";

export const pollId="10000000-0000-4000-8000-000000000001";
const personId="20000000-0000-4000-8000-000000000001";
export const actor=makeTestActor("administrator",[B1],{personId});
export const t=Date.parse("2026-10-23T10:00:00Z")*1000;
export const body={question:"Когда?",options:[{key:"private_sat",label:"Суббота"},{key:"private_sun",label:"Воскресенье"}],building_ids:[B1],closes_at:"2026-11-01T10:00:00Z",reason:"Согласуем день"};
type R=Record<string,unknown>;
export function harness(member=true) {
  const s:{now:number;poll:R|null;answer:R|null;events:R[];logs:R[];audit:AuditEntryInput[];keys:Map<string,R>;result:R|null;participants:string[];notices:R[];resultReads:number;cancelGuardError:boolean}={now:t,poll:null,answer:null,events:member?[{id:"1",connection_id:"link",person_id:personId,building_id:B1,is_test:false,enabled:true,effective_at:String(t-1000000),valid_from:null,valid_until:null}]:[],logs:[],audit:[],keys:new Map(),result:null,participants:[],notices:[],resultReads:0,cancelGuardError:false};
  const exec:DbExecutor={async query<T>(sql:string,params:readonly unknown[]=[]):Promise<T[]> {
    let rows:unknown[]=[];
    if(sql.startsWith("select public.audience_clock") || sql.startsWith("select pg_advisory"))rows=[];
    else if(sql.startsWith("with clock"))rows=[{at:new Date(s.now/1000),us:String(s.now)}];
    else if(sql.includes("from audience_history_meta"))rows=[{starts_at:String(t-2000000),starts_us:String(t-2000000)}];
    else if(sql.includes("from audience_connection_event e"))rows=s.events;
    else if(sql.startsWith("select request_hash,response"))rows=s.keys.has(String(params[0]))?[s.keys.get(String(params[0]))]:[];
    else if(sql.startsWith("insert into idempotency_key"))s.keys.set(String(params[0]),{request_hash:params[2],response:JSON.parse(String(params[3]))});
    else if(sql.startsWith("select id from building"))rows=[{id:B1}];
    else if(sql.startsWith("select id from poll where state='open'"))rows=s.poll?.state==="open"?[{id:pollId}]:[];
    else if(sql.startsWith("select person_id,option_key,version"))rows=s.answer?[{...s.answer,person_id:personId}]:[];
    else if(sql.startsWith("select person_id from poll_answer"))rows=s.answer?[{person_id:personId}]:[];
    else if(sql.startsWith("insert into poll_result("))s.result={participants_count:params[1],distribution:JSON.parse(String(params[2])),as_of:s.poll!.closes_at};
    else if(sql.startsWith("insert into poll_result_participant"))s.participants=[...(params[1] as string[])];
    else if(sql.startsWith("select 1 from poll_result_participant"))rows=s.participants.includes(String(params[1]))?[{exists:true}]:[];
    else if(sql.startsWith("select participants_count,distribution,as_of")){s.resultReads++;rows=s.result?[s.result]:[];}
    else if(sql.startsWith("update poll_answer a set excluded_at"))rows=[];
    else if(sql.startsWith("insert into outbox(event_type,payload,dedup_key)")){
      for(const notice of JSON.parse(String(params[0])) as R[])if(!s.notices.some(n=>n.key===notice.key))s.notices.push(notice);
    }
    else if(sql.startsWith("select p.*"))rows=s.poll?[{...s.poll}]:[];
    else if(sql.startsWith("insert into poll(")){
      s.poll={id:pollId,question:params[0],options:JSON.parse(String(params[1])),building_ids:params[2],closes_at:params[3],closes_us:String(Date.parse(String(params[3]))*1000),is_test:false,state:"draft",version:1,cancel_reason:null};rows=[{...s.poll}];
    }else if(sql.startsWith("update poll set state='open'")){
      s.poll={...s.poll,state:"open",version:Number(s.poll!.version)+1};rows=[{...s.poll}];
    }else if(sql.startsWith("update poll set state='closed'")){
      s.poll={...s.poll,state:"closed",version:Number(s.poll!.version)+1};
    }else if(sql.startsWith("update poll set state='canceled'")){
      if(s.cancelGuardError)throw Object.assign(new Error("Elapsed poll cannot be canceled"),{code:"23514"});
      s.poll={...s.poll,state:"canceled",cancel_reason:params[1],version:Number(s.poll!.version)+1};rows=[{...s.poll}];
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
