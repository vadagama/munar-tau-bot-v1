import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { getPoll } from "../../src/domains/polls/service.ts";
import { listPolls } from "../../src/domains/polls/list.ts";

describeWithDb("POL список с PDP",getDb=>{
  it("отбирает доступные опросы до пагинации, отделяет режим и повторяет связь",async()=>{
    const db=getDb(),actor=await actorForPerson(db,SEED.testExecutorPersonId,true),deps={db,audit:new SqlAuditRepo()};
    const [premise]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','POL-list',true) returning id",[SEED.building1]);
    await db.query("insert into connection(person_id,premises_id,role,basis,status) values($1,$2,'resident','family','active')",[actor.person.id,premise!.id]);
    await db.query(`insert into poll(question,options,building_ids,closes_at,is_test,created_by)
      select case when n<=2 then 'Видимый '||n else 'Скрытый '||n end,
      '[{"key":"yes","label":"Да"},{"key":"no","label":"Нет"}]',
      array[case when n<=2 then $1::uuid else $2::uuid end],clock_timestamp()+interval '1 hour',true,$3
      from generate_series(1,27) n`,[SEED.building1,SEED.building2,SEED.testAdminPersonId]);
    await db.query(`insert into poll(question,options,building_ids,closes_at,is_test,created_by)
      values('Другой режим','[{"key":"yes","label":"Да"},{"key":"no","label":"Нет"}]',array[$1::uuid],clock_timestamp()+interval '1 hour',false,$2)`,[SEED.building1,SEED.chairmanPersonId]);
    await db.query("update poll set state='open',opened_at=clock_timestamp(),version=version+1 where state='draft'");
    const first=await listPolls(deps,actor,{limit:1});
    expect(first.items).toHaveLength(1);expect(first.has_more).toBe(true);expect(first.items[0]?.question).toBe("Видимый 2");
    const second=await listPolls(deps,actor,{offset:1,limit:1});
    expect(second.items[0]?.question).toBe("Видимый 1");expect(second.has_more).toBe(false);
    expect((await listPolls(deps,actor,{offset:2,limit:1})).items).toHaveLength(0);
    expect(JSON.stringify(first)).not.toContain("person_id");expect(JSON.stringify(first)).not.toContain("option_key");
    expect(first.items[0]?.buildings).toEqual([{id:SEED.building1,label:"Дом 1"}]);
    const card=await getPoll(deps,actor,first.items[0]!.id);
    expect(card.buildings).toEqual(first.items[0]!.buildings);expect(card.deadline_passed).toBe(false);

    await db.query("update connection set status='revoked' where person_id=$1",[actor.person.id]);
    expect((await listPolls(deps,actor)).items).toHaveLength(0);
  });
});
