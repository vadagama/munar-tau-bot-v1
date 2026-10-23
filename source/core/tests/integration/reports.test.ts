import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { operationalReport } from "../../src/domains/reports/service.ts";
import { makeTestActor } from "../../src/testing/actors.ts";
import type { DbClient } from "../../src/db/client.ts";
import type { RegistryDeps } from "../../src/domains/registry/service.ts";
async function request(db:DbClient,number:string,building:string,extra:{route?:string;subject?:string;at?:string}={}){
 const [row]=await db.query<{id:string}>(`insert into request(number,state,author_person_id,created_by,description,source,is_test,building_id,open_at,complaint_route,complaint_subject_person_id,created_at,updated_at)
 values($1,'new',$2,$2,'Не должно попасть в отчёт','web',true,$3,coalesce($6::timestamptz,now()),$4,$5,coalesce($6::timestamptz,now()),coalesce($6::timestamptz,now())) returning id`,[number,SEED.testExecutorPersonId,building,extra.route??"administrator",extra.subject??null,extra.at??null]);
 await db.query("insert into request_log(request_id,from_state,to_state,actor_person_id,actor_role,meta,at) values($1,null,'new',$2,'administrator','{\"action\":\"created\"}',coalesce($3::timestamptz,now()))",[row!.id,SEED.testAdminPersonId,extra.at??null]);return row!.id;
}
describeWithDb("VS-8 операционные отчёты: область и snapshot",getDb=>{
 it("SQL исключает чужой дом, chairman-only и жалобу на актора до агрегации",async()=>{
  const db=getDb(),actor=makeTestActor("administrator",[SEED.building1],{personId:SEED.testAdminPersonId,isTest:true});
  const [foreign]=await db.query<{id:string}>("insert into building(code,name) values('REP-foreign','Чужой дом') returning id");
  await request(db,"REP-good",SEED.building1);await request(db,"REP-foreign",foreign!.id);await request(db,"REP-private",SEED.building1,{route:"chairman"});await request(db,"REP-self",SEED.building1,{subject:actor.person.id});
  const day=(await db.query<{day:string}>("select (clock_timestamp() at time zone 'Asia/Almaty')::date::text as day"))[0]!.day;
  const next=new Date(Date.parse(day+"T00:00:00Z")+86400000).toISOString().slice(0,10);
  const result=await operationalReport({db} as RegistryDeps,actor,"requests",{from:day,to:next});expect(result).toMatchObject({total:1,flows:{received:1},items:[{number:"REP-good"}]});expect(JSON.stringify(result)).not.toContain("Не должно попасть");
 },240000);
 it("переназначение после as_of не переписывает исполнителя и фильтр исторического снимка",async()=>{
  const db=getDb(),actor=makeTestActor("administrator",[SEED.building1],{personId:SEED.testAdminPersonId,isTest:true}),parent=await request(db,"REP-parent",SEED.building1,{at:"2026-10-01T00:00:00Z"});
  const [task]=await db.query<{id:string}>(`insert into task(request_id,title,instruction,assignee_person_id,state,due_at,is_test,created_by,created_at,updated_at)
   values($1,'Двор','Инструкция',$2,'awaiting_acceptance','2026-11-01',true,$3,'2026-10-01','2026-10-23') returning id`,[parent,SEED.testExecutorPersonId,actor.person.id]);
  await db.query(`insert into task_log(task_id,from_state,to_state,actor_person_id,meta,at) values
   ($1,null,'awaiting_acceptance',$2,jsonb_build_object('action','assigned','assignee_person_id',$2::text),'2026-10-20'),
   ($1,'awaiting_acceptance','awaiting_acceptance',$2,jsonb_build_object('action','assign','previous_assignee_id',$2::text,'assignee_person_id',$3::text),'2026-10-23')`,[task!.id,actor.person.id,SEED.testExecutorPersonId]);
  const result=await operationalReport({db} as RegistryDeps,actor,"tasks",{from:"2026-10-01",to:"2026-11-01",assignee_id:actor.person.id},{asOf:"2026-10-22T00:00:00Z"});expect(result).toMatchObject({total:1,items:[{assignee_person_id:actor.person.id}],workload:[{person_id:actor.person.id,open:1}]});
 },240000);
});
