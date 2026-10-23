import { expect,it } from "vitest";
import type { DbClient } from "../../src/db/client.ts";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { closePollById } from "../../src/domains/polls/jobs.ts";
import { cancelPoll,getPollResults } from "../../src/domains/polls/transitions.ts";
import { dispatchNotices } from "../../src/domains/notifications/service.ts";
import { listFailures,completeFollowup } from "../../src/domains/notifications/followup.ts";
import { sendNotifications } from "../../src/domains/notifications/delivery.ts";

/** SQL-фикстура задаёт короткий серверный срок после настройки реестра:
 * при большом RTT сервисы создания уже проверены отдельно в P02. */
async function fixture(db:DbClient,seconds=3600){
  await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')",[SEED.testAdminPersonId]);
  const admin=await actorForPerson(db,SEED.testAdminPersonId,true),resident=await actorForPerson(db,SEED.testExecutorPersonId,true);
  const [premise]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','POL-result',true) returning id",[SEED.building1]);
  await db.query("insert into connection(person_id,premises_id,role,basis,status) values($1,$3,'owner','ownership','active'),($2,$3,'resident','family','active')",[SEED.testAdminPersonId,SEED.testExecutorPersonId,premise!.id]);
  const [poll]=await db.query<{id:string}>(`insert into poll(question,options,building_ids,closes_at,is_test,created_by)
    values('Встреча','[{"key":"private_yes","label":"Да"},{"key":"private_no","label":"Нет"}]',array[$1::uuid],clock_timestamp()+$2*interval '1 second',true,$3) returning id`,[SEED.building1,seconds,SEED.testAdminPersonId]);
  await db.query("update poll set state='open',opened_at=clock_timestamp(),version=version+1 where id=$1",[poll!.id]);
  return {deps:{db,audit:new SqlAuditRepo()},admin,resident,id:poll!.id};
}
async function waitUntilClose(db:DbClient,id:string){
  await db.query("select pg_sleep(greatest(0,extract(epoch from closes_at-clock_timestamp()))::double precision+0.01) from poll where id=$1",[id]);
}

describeWithDb("POL окончательные итоги",getDb=>{
  it("позднее конкурентное закрытие использует историю на срок; итог и доступ участника сохраняются после переезда",async()=>{
    const db=getDb(),f=await fixture(db,20);
    await db.query("insert into poll_answer(poll_id,person_id,option_key,version,answered_at) values($1,$2,'private_yes',1,clock_timestamp()),($1,$3,'private_no',1,clock_timestamp())",[f.id,SEED.testAdminPersonId,SEED.testExecutorPersonId]);
    await db.query("update connection set status='revoked' where person_id=$1",[SEED.testExecutorPersonId]);
    await db.query("update connection set status='active' where person_id=$1",[SEED.testExecutorPersonId]);
    await waitUntilClose(db,f.id);
    // Этот отзыв уже после срока: прежний голос должен остаться в итоге.
    await db.query("update connection set status='revoked' where person_id=$1",[SEED.testAdminPersonId]);
    const closed=await Promise.all([closePollById(f.deps,f.id,Date.now()+120000),closePollById(f.deps,f.id,Date.now()+120000)]);
    expect(closed.filter(Boolean)).toHaveLength(1);
    const result=await getPollResults(f.deps,f.admin,f.id);
    expect(result).toMatchObject({final:true,participants_count:1,distribution:[{option_key:"private_yes",count:1},{option_key:"private_no",count:0}]});
    expect(JSON.stringify(result)).not.toContain(SEED.testAdminPersonId);
    await expect(getPollResults(f.deps,f.resident,f.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    await db.query("update staff_assignment set status='revoked' where person_id=$1",[SEED.testAdminPersonId]);
    const moved=await actorForPerson(db,SEED.testAdminPersonId,true);
    expect(moved.assignments).toHaveLength(0);
    expect(await getPollResults(f.deps,moved,f.id)).toEqual(result);
    await expect(db.query("update poll_result set participants_count=0 where poll_id=$1",[f.id])).rejects.toMatchObject({code:"42501"});
    const proof=await db.query<{exact:boolean}>("select r.as_of=p.closes_at as exact from poll_result r join poll p on p.id=r.poll_id where p.id=$1",[f.id]);
    expect(proof[0]?.exact).toBe(true);
    expect(await db.query("select 1 from poll_answer_log where poll_id=$1 and action='excluded'",[f.id])).toHaveLength(1);
    expect(await db.query("select 1 from outbox where dedup_key like $1",[`poll.closed:${f.id}:%`])).toHaveLength(1);
    await db.query(`insert into notification(telegram_user_id,text,dedup_key,recipient_person_id,channel,event_type,event_ref,audience,is_test,bot)
      select telegram_user_id,'Старое приглашение',$2,person_id,'simulator','personal',jsonb_build_object('pollId',$3::text,'pollEvent','opened'),'personal',true,'resident'
      from profile where person_id=$1 and archived_at is null`,[SEED.testAdminPersonId,`poll.opened:${f.id}:stale`,f.id]);
    await sendNotifications(f.deps,async()=>{throw new Error("Не должна быть внешняя отправка");},Date.now()+120000);
    const stale=await db.query<{state:string}>("select state from notification where dedup_key=$1",[`poll.opened:${f.id}:stale`]);
    expect(stale[0]?.state).toBe("canceled");

  },240000);
  it("отмена скрывает распределение и один раз доставляет причину прежнему участнику без действующей связи",async()=>{
    const db=getDb(),f=await fixture(db);
    await db.query("insert into poll_answer(poll_id,person_id,option_key,version,answered_at) values($1,$2,'private_yes',1,clock_timestamp())",[f.id,SEED.testExecutorPersonId]);
    await db.query("update connection set status='revoked' where person_id=$1",[SEED.testExecutorPersonId]);
    const body={expected_version:2,reason:"Уточняем формулировку"};
    await cancelPoll(f.deps,f.admin,f.id,body,"cancel");
    await cancelPoll(f.deps,f.admin,f.id,body,"cancel");
    await expect(getPollResults(f.deps,f.admin,f.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(getPollResults(f.deps,f.resident,f.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(await db.query("select 1 from poll_result where poll_id=$1",[f.id])).toHaveLength(0);
    const notices=await db.query<{payload:Record<string,unknown>}>("select payload from outbox where dedup_key=$1",[`poll.canceled:${f.id}:${SEED.testExecutorPersonId}`]);
    expect(notices).toHaveLength(1);expect(JSON.stringify(notices)).not.toContain("private_yes");
    await dispatchNotices(f.deps,Date.now()+120000);
    let external=0;
    await sendNotifications(f.deps,async()=>{external++;},Date.now()+120000);
    expect(external).toBe(0);
    const sent=await db.query<{id:string;state:string;channel:string;text:string;reply_markup:unknown}>("select id,state,channel,text,reply_markup from notification where dedup_key=$1",[`poll.canceled:${f.id}:${SEED.testExecutorPersonId}`]);
    expect(sent[0]).toMatchObject({state:"sent",channel:"simulator"});
    expect(sent[0]?.text).toContain(body.reason);expect(JSON.stringify(sent[0]?.reply_markup)).toContain(`/poll ${f.id}`);
    await db.query("update notification set state='failed' where id=$1",[sent[0]!.id]);
    await db.query("insert into staff_assignment(person_id,role) values($1,'chairman')",[SEED.testAdminPersonId]);
    const chairman=await actorForPerson(db,SEED.testAdminPersonId,true);
    expect((await listFailures(db,chairman)).items).toEqual([]);
    const [followup]=await db.query<{id:string}>("insert into notification_followup(notification_id) values($1) returning id",[sent[0]!.id]);
    await expect(completeFollowup(f.deps,chairman,followup!.id,"Не раскрывать состав")).rejects.toMatchObject({code:"NOT_FOUND"});

  },240000);
  it("раннее закрытие и снимок до срока запрещены БД; итоговые таблицы закрыты RLS",async()=>{
    const db=getDb(),f=await fixture(db);
    await expect(db.query("update poll set state='closed',closed_at=clock_timestamp(),version=version+1 where id=$1",[f.id])).rejects.toMatchObject({code:"23514"});
    await expect(db.query(`insert into poll_result(poll_id,as_of,participants_count,distribution)
      select id,closes_at,0,'[{"option_key":"private_yes","count":0},{"option_key":"private_no","count":0}]' from poll where id=$1`,[f.id])).rejects.toMatchObject({code:"23514"});
    const rights=await db.query<{allowed:boolean}>("select has_table_privilege('authenticated',name,'SELECT') as allowed from unnest(array['poll_result','poll_result_participant']) name");
    expect(rights.every(r=>!r.allowed)).toBe(true);
  });
});
