import type { DbClient,DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { B1,B2,makeTestActor } from "../../testing/actors.ts";
export const itemId="10000000-0000-4000-8000-000000000001",authorId="20000000-0000-4000-8000-000000000001";
export const commentId="30000000-0000-4000-8000-000000000001",actionId="40000000-0000-4000-8000-000000000001",appealId="50000000-0000-4000-8000-000000000001";
export function moderationFixture(){
 const resident=makeTestActor("executor",[],{personId:authorId});resident.assignments=[];
 const manager=makeTestActor("administrator",[B1]),chair=makeTestActor("chairman",[]),other=makeTestActor("executor",[]);
 const s={at:"2026-10-23T10:00:00Z",members:[B1],restricted:false,keys:new Map<string,unknown>(),comments:[] as Record<string,unknown>[],actions:[] as Record<string,unknown>[],appeals:[] as Record<string,unknown>[],decisions:[] as unknown[][],outbox:[] as Record<string,unknown>[],audits:[] as unknown[]};
 const item={id:itemId,author_person_id:authorId,requested_building_ids:[B1],approved_building_ids:[B1],publication_state:"published",stage:"collecting",is_test:false,version:2};
 const exec:DbExecutor={async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{let rows:unknown[]=[];
  if(sql.startsWith("select public.audience_clock")||sql.startsWith("select pg_advisory")){}
  else if(sql.startsWith("with initiative_clock"))rows=[{at:new Date(s.at),at_text:s.at,us:String(Date.parse(s.at)*1000),building_ids:s.members,active:true,restricted:s.restricted}];
  else if(sql.startsWith("select * from initiative where"))rows=[item];
  else if(sql.startsWith("select request_hash,response"))rows=s.keys.has(String(p[0]))?[s.keys.get(String(p[0]))]:[];
  else if(sql.startsWith("insert into idempotency_key"))s.keys.set(String(p[0]),{request_hash:p[2],response:JSON.parse(String(p[3]))});
  else if(sql.startsWith("insert into initiative_comment(")){const row={id:commentId,initiative_id:p[0],author_person_id:p[1],body:p[2],created_at:s.at,author_name:"Житель",is_test:false,hidden:false};s.comments.push(row);rows=[row];}
  else if(sql.includes("from initiative_comment c")){
   rows=s.comments.filter(c=>sql.includes("c.id=$1")?c.id===p[0]:c.initiative_id===p[0]);
   rows=(rows as Record<string,unknown>[]).map(c=>({...c,hidden:s.actions.some(a=>a.target_comment_id===c.id&&!a.revoked_at)}));
   if(sql.includes("and (not exists"))rows=(rows as Record<string,unknown>[]).filter(c=>!c.hidden||c.author_person_id===p[1]||p[2]===true).slice(Number(p[3]),Number(p[3])+21);
  }
  else if(sql.startsWith("select * from moderation_action where"))rows=s.actions.filter(a=>a.id===p[0]);
  else if(sql.startsWith("select id from moderation_action"))rows=s.actions.filter(a=>a.target_comment_id===p[0]&&!a.revoked_at);
  else if(sql.startsWith("insert into moderation_action(")){const row={id:actionId,initiative_id:p[0],kind:p[1],target_person_id:p[2],target_comment_id:p[3],reason:p[4],original_until_at:p[5],until_at:p[5],created_by:p[6],created_at:s.at,is_test:p[7],version:1,revoked_at:null};s.actions.push(row);rows=[row];}
  else if(sql.startsWith("select * from moderation_appeal where"))rows=s.appeals.filter(a=>a.id===p[0]);
  else if(sql.startsWith("select id from moderation_appeal where"))rows=s.appeals.filter(a=>a.action_id===p[0]&&a.status==="open");
  else if(sql.startsWith("insert into moderation_appeal(")){const row={id:appealId,action_id:p[0],appellant_person_id:p[1],reason:p[2],status:"open",version:1,created_at:s.at};s.appeals.push(row);rows=[row];}
  else if(sql.startsWith("update moderation_action set")){const row=s.actions.find(a=>a.id===p[0])!;Object.assign(row,{until_at:p[1] instanceof Date?p[1].toISOString():p[1],revoked_at:p[2],version:Number(row.version)+1});rows=[row];}
  else if(sql.startsWith("update moderation_appeal set")){const row=s.appeals.find(a=>a.id===p[0])!;Object.assign(row,{status:"resolved",version:Number(row.version)+1});rows=[row];}
  else if(sql.startsWith("insert into moderation_decision("))s.decisions.push([...p]);
  else if(sql.startsWith("insert into outbox("))s.outbox.push(JSON.parse(String(p[0])));
  else throw new Error(`Unexpected SQL: ${sql}`);
  return structuredClone(rows) as T[];
 }};
 const db:DbClient={...exec,close:async()=>{},transaction:async fn=>{const old=structuredClone(s);try{return await fn(exec);}catch(e){Object.assign(s,old);throw e;}}};
 const deps:RegistryDeps={db,audit:{async append(_exec,a){s.audits.push(a);return {...a,id:1,at:s.at};},async list(){throw new Error("unused");}}};
 return {s,item,resident,manager,chair,other,deps,foreign:makeTestActor("administrator",[B2])};
}
