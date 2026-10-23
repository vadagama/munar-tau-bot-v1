import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { submitInitiative,transitionInitiative } from "../../src/domains/initiatives/service.ts";

describeWithDb("VS-8 инициативы: транзакции и схема",getDb=>{
  it("проходит этапы без потери микросекунд публикации; повторы и история не затираются",async()=>{
    const db=getDb();await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')",[SEED.testAdminPersonId]);
    const [premise]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','IDEA-test',true) returning id",[SEED.building1]);
    await db.query("insert into connection(person_id,premises_id,role,basis,status) values($1,$2,'resident','family','active')",[SEED.testAdminPersonId,premise!.id]);
    const actor=await actorForPerson(db,SEED.testAdminPersonId,true),deps={db,audit:new SqlAuditRepo()};
    const body={title:"Встреча",body:"Обсудить двор",location_text:"Двор",building_ids:[SEED.building1]};
    const created=await submitInitiative(deps,actor,body,"create");
    expect((await submitInitiative(deps,actor,body,"create")).id).toBe(created.id);
    await transitionInitiative(deps,actor,created.id,"publish",{expected_version:1,reason:"Проверено",building_ids:[SEED.building1]},"publish");
    const before=await db.query<{stamp:string}>("select (extract(epoch from published_at)*1000000)::bigint as stamp from initiative where id=$1",[created.id]);
    await transitionInitiative(deps,actor,created.id,"assessing",{expected_version:2,reason:"Оценка"},"assess");
    await transitionInitiative(deps,actor,created.id,"planned",{expected_version:3,reason:"План",basis:"Решение ОСИ",responsible_person_id:actor.person.id,estimated_due_at:"2026-11-01T10:00:00Z"},"plan");
    await transitionInitiative(deps,actor,created.id,"implementing",{expected_version:4,reason:"Начало"},"start");
    const done=await transitionInitiative(deps,actor,created.id,"completed",{expected_version:5,reason:"Выполнено"},"finish");
    expect(done).toMatchObject({stage:"completed",final_support_count:0,version:6});
    expect(await db.query("select (extract(epoch from published_at)*1000000)::bigint as stamp from initiative where id=$1",[created.id])).toEqual(before);
    expect(await db.query("select id from initiative_log where initiative_id=$1",[created.id])).toHaveLength(6);
    await expect(db.query("update initiative_log set reason='Подмена' where initiative_id=$1",[created.id])).rejects.toMatchObject({code:"42501"});
    await expect(db.query("delete from initiative where id=$1",[created.id])).rejects.toMatchObject({code:"42501"});
  },240000);
  it("закрывает клиентский доступ ко всем новым таблицам",async()=>{
    const rows=await getDb().query<{relrowsecurity:boolean;exposed:boolean}>(`select c.relrowsecurity,
      has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT') as exposed
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname=any($1::text[])`,[["initiative","initiative_log","initiative_support","initiative_support_log","moderation_action"]]);
    expect(rows).toHaveLength(5);for(const row of rows)expect(row).toEqual({relrowsecurity:true,exposed:false});
  });
  it("снимок с JSON null вместо ID не проходит конкретный CHECK",async()=>{
    await expect(getDb().query(`insert into initiative(author_person_id,title,body,location_text,requested_building_ids,is_test,decision_document_version_id,decision_snapshot)
      values($1,'Тест','Тест','Двор',array[$2::uuid],true,gen_random_uuid(),'{"id":null}')`,[SEED.testAdminPersonId,SEED.building1]))
      .rejects.toMatchObject({code:"23514",constraint_name:"initiative_decision_snapshot_id_matches"});
  });
});
