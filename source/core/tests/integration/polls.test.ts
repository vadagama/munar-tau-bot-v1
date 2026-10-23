import { expect, it } from "vitest";
import type { DbClient } from "../../src/db/client.ts";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { savePoll,openPoll,answerPoll,getPoll } from "../../src/domains/polls/service.ts";

async function fixture(db:DbClient,duration=3600000){
  await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')",[SEED.testAdminPersonId]);
  const admin=await actorForPerson(db,SEED.testAdminPersonId,true),resident=await actorForPerson(db,SEED.testExecutorPersonId,true);
  const [premise]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','POL-vote',true) returning id",[SEED.building1]);
  const [link]=await db.query<{id:string}>("insert into connection(person_id,premises_id,role,basis,status) values($1,$2,'resident','family','active') returning id",[SEED.testExecutorPersonId,premise!.id]);
  const deps={db,audit:new SqlAuditRepo()};
  const draft=await savePoll(deps,admin,null,{question:"Когда проводить встречу?",options:[{key:"secret_sat",label:"Суббота"},{key:"secret_sun",label:"Воскресенье"}],building_ids:[SEED.building1],closes_at:new Date(Date.now()+duration).toISOString(),reason:"Тест POL"},"draft");
  const poll=await openPoll(deps,admin,draft.id,{expected_version:draft.version,reason:"Открываем"},"open");
  return {deps,admin,resident,poll,link:link!.id};
}

describeWithDb("POL личные ответы",getDb=>{
  it("один ответ меняется, replay не повторяет эффект; восстановление требует нового ответа; аудит без выбора",async()=>{
    const db=getDb(),f=await fixture(db);
    const first=await answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sat",expected_version:0},"first");
    const replay=await answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sat",expected_version:0},"first");
    expect(replay.version).toBe(first.version);
    await answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sun",expected_version:1},"change");
    expect(await db.query("select 1 from poll_answer where poll_id=$1",[f.poll.id])).toHaveLength(1);
    await db.query("update connection set status='revoked' where id=$1",[f.link]);
    await db.query("update connection set status='active' where id=$1",[f.link]);
    expect((await getPoll(f.deps,f.resident,f.poll.id)).own_answer?.included).toBe(false);
    await answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sat",expected_version:2},"rejoin");
    expect((await getPoll(f.deps,f.resident,f.poll.id)).own_answer?.included).toBe(true);
    expect((await getPoll(f.deps,f.admin,f.poll.id)).own_answer).toBeNull();
    const events=await db.query<{action:string}>("select action from poll_answer_log where poll_id=$1 order by id",[f.poll.id]);
    expect(events.map(e=>e.action)).toEqual(["answer","answer","excluded","answer"]);
    const audit=await db.query("select before,after,meta from audit_log where entity_id=$1",[f.poll.id]);
    expect(JSON.stringify(audit)).not.toContain("secret_sat");expect(JSON.stringify(audit)).not.toContain("secret_sun");
  });
  it("БД защищает открытые параметры, варианты и RLS; роль управляющего не заменяет связь",async()=>{
    const db=getDb(),f=await fixture(db);
    await expect(db.query("update poll set question='Подмена',version=version+1 where id=$1",[f.poll.id])).rejects.toMatchObject({code:"23514"});
    await expect(answerPoll(f.deps,f.admin,f.poll.id,{option_key:"secret_sat",expected_version:0},"manager-vote")).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sat",expected_version:0,person_id:SEED.testAdminPersonId},"spoof")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(db.query("insert into poll_answer(poll_id,person_id,option_key,version,answered_at) values($1,$2,'missing',1,clock_timestamp())",[f.poll.id,f.resident.person.id])).rejects.toMatchObject({code:"23514"});
    const rights=await db.query<{allowed:boolean}>("select has_table_privilege('authenticated',name,'SELECT') as allowed from unnest(array['poll','poll_answer','poll_answer_log']) name");
    expect(rights.every(row=>!row.allowed)).toBe(true);
  });
  it("два конкурентных ответа с одной версией дают один эффект и один 409",async()=>{
    const db=getDb(),f=await fixture(db);
    const results=await Promise.allSettled([
      answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sat",expected_version:0},"a"),
      answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sun",expected_version:0},"b"),
    ]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const rejected=results.find(r=>r.status==="rejected");
    expect(rejected?.status==="rejected"?rejected.reason:null).toMatchObject({code:"CONCURRENT_MODIFICATION"});
    expect(await db.query("select 1 from poll_answer where poll_id=$1",[f.poll.id])).toHaveLength(1);
    expect(await db.query("select 1 from poll_answer_log where poll_id=$1 and action='answer'",[f.poll.id])).toHaveLength(1);
  });
  it("истёкший срок отклоняет ответ без фонового закрытия",async()=>{
    const db=getDb(),f=await fixture(db,20000);
    await db.query("select pg_sleep(greatest(0,extract(epoch from closes_at-clock_timestamp()))::double precision+0.01) from poll where id=$1",[f.poll.id]);
    await expect(answerPoll(f.deps,f.resident,f.poll.id,{option_key:"secret_sat",expected_version:0},"late")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
    await expect(db.query("insert into poll_answer(poll_id,person_id,option_key,version,answered_at) values($1,$2,'secret_sat',1,clock_timestamp())",[f.poll.id,f.resident.person.id])).rejects.toMatchObject({code:"23514"});
    expect(await db.query("select 1 from poll_answer where poll_id=$1",[f.poll.id])).toHaveLength(0);
  });
});
