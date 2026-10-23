import { submitInitiative } from "./service.ts";
import { B1,B2,makeTestActor } from "../../testing/actors.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { DbClient,DbExecutor } from "../../db/client.ts";
import type { InitiativeRow } from "./types.ts";
export const person="20000000-0000-4000-8000-000000000001";
export const id="10000000-0000-4000-8000-000000000001";
export const body={title:"Встреча",body:"Обсуждение двора",location_text:"Двор",building_ids:[B1]};
const t=Date.parse("2026-10-23T10:00:00Z")*1000;
export function fixture(){
  const s:{row:InitiativeRow|null;members:string[];audit:string[];keys:Map<string,unknown>;logs:unknown[][];support:Record<string,unknown>|null;supportLogs:unknown[][];events:Record<string,unknown>[];now:number}={row:null,members:[B1],audit:[],keys:new Map(),logs:[],support:null,supportLogs:[],now:t,events:[{id:"1",connection_id:"link",person_id:person,building_id:B1,is_test:false,enabled:true,effective_at:String(t-1000),valid_from:null,valid_until:null}]};
  const exec:DbExecutor={async query<T>(sql:string,params:readonly unknown[]=[]):Promise<T[]>{
    let rows:unknown[]=[];
    if(sql.startsWith("select public.audience_clock") || sql.startsWith("select pg_advisory"))rows=[];
    else if(sql.startsWith("with initiative_clock"))rows=[{at:new Date(s.now/1000),at_text:new Date(s.now/1000).toISOString(),us:String(s.now),building_ids:s.members,active:true,restricted:false}];
    else if(sql.includes("from audience_history_meta"))rows=[{starts_at:String(t-2000),starts_us:String(t-2000)}];
    else if(sql.includes("from audience_connection_event e"))rows=s.events;
    else if(sql.startsWith("select version,supported_at"))rows=s.support?[s.support]:[];
    else if(sql.startsWith("insert into initiative_support(")){
      s.support={version:Number(s.support?.version??0)+1,supported_at:new Date(s.now/1000),supported_us:String(s.now),withdrawn_at:null,excluded_at:null};rows=[s.support];
    }else if(sql.startsWith("update initiative_support set withdrawn_at")){
      s.support={...s.support,version:Number(s.support!.version)+1,withdrawn_at:new Date(s.now/1000),withdrawn_us:String(s.now)};rows=[s.support];
    }else if(sql.startsWith("insert into initiative_support_log")){
      if(!s.supportLogs.some(l=>l[2]===params[2]&&l[3]===params[3]))s.supportLogs.push([...params]);
    }
    else if(sql.startsWith("select request_hash,response"))rows=s.keys.has(String(params[0]))?[s.keys.get(String(params[0]))]:[];
    else if(sql.startsWith("insert into idempotency_key"))s.keys.set(String(params[0]),{request_hash:params[2],response:JSON.parse(String(params[3]))});
    else if(sql.startsWith("select * from initiative where"))rows=s.row?[structuredClone(s.row)]:[];
    else if(sql.startsWith("select id from building"))rows=[{id:B1},{id:B2}];
    else if(sql.startsWith("insert into initiative(")){
      s.row={id,author_person_id:params[0],title:params[1],body:params[2],location_text:params[3],requested_building_ids:params[4],approved_building_ids:[],is_test:false,
        version:1,publication_state:"submitted",stage:null,review_reason:null,stage_reason:null,plan_basis:null,owner_decision_required:false,
        responsible_person_id:null,decision_document_version_id:null,decision_snapshot:null,estimated_due_at:null,created_at:new Date(),published_at:null,completed_at:null,support_closed_at:null,final_support_count:null} as InitiativeRow;
      rows=[structuredClone(s.row)];
    }else if(sql.startsWith("update initiative set")){
      const patch=JSON.parse(String(params[1]));s.row={...s.row,...patch,version:Number(s.row!.version)+1} as InitiativeRow;rows=[structuredClone(s.row)];
    }else if(sql.startsWith("insert into initiative_log"))s.logs.push([...params]);
    else if(sql.startsWith("insert into initiative_support_log") || sql.startsWith("update initiative_support"))rows=[];
    else throw new Error(`Unexpected SQL: ${sql}`);
    return rows as T[];
  }};
  const db:DbClient={...exec,close:async()=>{},transaction:async fn=>{
    const old=structuredClone(s);try{return await fn(exec);}catch(e){Object.assign(s,old);throw e;}
  }};
  const deps:RegistryDeps={db,audit:{async append(_exec,a){s.audit.push(a.action);return {...a,id:1,at:new Date().toISOString()};},async list(){throw new Error("unused");}}};
  const actor=makeTestActor("administrator",[B1],{personId:person});
  return {s,deps,actor,submit:()=>submitInitiative(deps,actor,body,"submit")};
}
