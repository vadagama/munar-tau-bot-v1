import { expect, it } from "vitest";
import type { DbClient } from "../../src/db/client.ts";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { reconcileOpenPolls } from "../../src/domains/polls/reconcile.ts";
import { getPoll, openPoll, savePoll } from "../../src/domains/polls/service.ts";

describeWithDb("POL фоновая сверка и приватность",getDb=>{
  it("ротация порций обходит все опросы; исключение закрыто, уникально и не меняет карточку",async()=>{
    const db=getDb(),deps={db,audit:new SqlAuditRepo()};
    const [premise]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','POL-privacy',true) returning id",[SEED.building1]);
    await db.query("insert into connection(person_id,premises_id,role,basis,status) values($1,$2,'resident','family','active')",[SEED.testExecutorPersonId,premise!.id]);
    const polls=await db.query<{id:string}>(`insert into poll(question,options,building_ids,closes_at,is_test,created_by)
      select 'Опрос '||n,'[{"key":"private_yes","label":"Да"},{"key":"private_no","label":"Нет"}]',array[$1::uuid],clock_timestamp()+interval '1 hour',true,$2 from generate_series(1,12) n returning id`,[SEED.building1,SEED.testAdminPersonId]);
    const id=polls[0]!.id;
    await db.query("update poll set state='open',opened_at=clock_timestamp(),version=version+1");
    await db.query("insert into poll_answer(poll_id,person_id,option_key,version,answered_at) values($1,$2,'private_yes',1,clock_timestamp())",[id,SEED.testExecutorPersonId]);
    await db.query("update connection set status='revoked' where person_id=$1",[SEED.testExecutorPersonId]);
    expect(await reconcileOpenPolls(deps,Date.now()+120000)).toBe(10);
    expect(await db.query("select poll_id from poll_reconciliation")).toHaveLength(10);
    expect(await reconcileOpenPolls(deps,Date.now()+120000)).toBe(10);
    expect(await db.query("select poll_id from poll_reconciliation")).toHaveLength(12);
    expect(await db.query("select version from poll where version<>2")).toHaveLength(0);
    expect(await db.query("select 1 from poll_answer_log where poll_id=$1 and action='excluded'",[id])).toHaveLength(1);
    await db.query("update connection set status='active' where person_id=$1",[SEED.testExecutorPersonId]);
    const actor=await actorForPerson(db,SEED.testExecutorPersonId,true);
    expect((await getPoll(deps,actor,id)).own_answer?.included).toBe(false);
    expect(await db.query("select id from audit_log where action like 'poll.%'")).toHaveLength(0);
    expect(await db.query("select id from outbox where dedup_key like 'poll.%'")).toHaveLength(0);
    await expect(db.transaction(async exec=>{await exec.query("set local role authenticated");return exec.query("select * from poll_answer_log");})).rejects.toMatchObject({code:"42501"});
    await expect(db.transaction(async exec=>{await exec.query("set local role anon");return exec.query("select * from poll_reconciliation");})).rejects.toMatchObject({code:"42501"});
  },300000);
  it("запись открытия использует одну серверную отметку, пересечение срока не вызывает SQL500",async()=>{
    const db=getDb();await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')",[SEED.testAdminPersonId]);
    const actor=await actorForPerson(db,SEED.testAdminPersonId,true),audit=new SqlAuditRepo(),deps={db,audit};
    const clock=await db.query<{closes_at:Date}>("select clock_timestamp()+interval '15 seconds' as closes_at");
    const poll=await savePoll(deps,actor,null,{question:"Граница открытия",options:[{key:"yes",label:"Да"},{key:"no",label:"Нет"}],building_ids:[SEED.building1],closes_at:clock[0]!.closes_at.toISOString(),reason:"Проверка"},"create");
    const delayed:DbClient={...db,transaction:fn=>db.transaction(exec=>fn({query:async(sql,params)=>{
      if(sql.startsWith("with opening"))await exec.query("select pg_sleep(greatest(0,extract(epoch from closes_at-clock_timestamp()))::double precision+0.01) from poll where id=$1",[poll.id]);
      return exec.query(sql,params);
    }}))};
    await expect(openPoll({db:delayed,audit},actor,poll.id,{expected_version:1,reason:"Открытие"},"open")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
    expect((await getPoll(deps,actor,poll.id)).state).toBe("draft");
    expect(await db.query("select id from audit_log where action='poll.open'")).toHaveLength(0);
  },120000);
});
