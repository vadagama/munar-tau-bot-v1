import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { deleteRegistry } from "../../src/domains/registry/service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { loadAudienceIntervals, audienceEligible } from "../../src/domains/registry/audience-history.ts";
import type { DbClient } from "../../src/db/client.ts";

async function fixture(db: DbClient) {
  const [premise] = await db.query<{ id: string }>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','POL-history',true) returning id", [SEED.building1]);
  const [link] = await db.query<{ id: string }>(`insert into connection(person_id,premises_id,role,basis,status,start_date,end_date,confirmed_by,confirmed_at)
    values($1,$2,'owner','ownership','active','2026-10-01','2026-10-31',$3,now()) returning id`, [SEED.testExecutorPersonId,premise!.id,SEED.testAdminPersonId]);
  return { premise: premise!.id, link: link!.id };
}
async function latest(db: DbClient, link: string) {
  const [row] = await db.query<{ enabled: boolean; building_id: string; valid_from: Date; valid_until: Date }>("select * from audience_connection_event where connection_id=$1 order by effective_at desc,id desc limit 1",[link]);
  return row!;
}

describeWithDb("POL история аудитории", (getDb) => {
  it("фиксирует сроки Алматы, отзыв, восстановление, режим, архив профиля и помещение", async () => {
    const db=getDb(), f=await fixture(db);
    expect(await latest(db,f.link)).toMatchObject({ enabled:true,building_id:SEED.building1 });
    expect((await latest(db,f.link)).valid_from.toISOString()).toBe("2026-09-30T19:00:00.000Z");
    expect((await latest(db,f.link)).valid_until.toISOString()).toBe("2026-10-31T19:00:00.000Z");
    for (const [sql,params,enabled] of [
      ["update connection set status='revoked' where id=$1",[f.link],false],
      ["update connection set status='active' where id=$1",[f.link],true],
      ["update profile set archived_at=now() where person_id=$1",[SEED.testExecutorPersonId],false],
      ["update profile set archived_at=null where person_id=$1",[SEED.testExecutorPersonId],true],
      ["update person set status='archived' where id=$1",[SEED.testExecutorPersonId],false],
      ["update person set status='active' where id=$1",[SEED.testExecutorPersonId],true],
      ["update premises set is_test=false where id=$1",[f.premise],false],
      ["update premises set is_test=true,building_id=$2 where id=$1",[f.premise,SEED.building2],true],
      ["update premises set status='archived' where id=$1",[f.premise],false],
    ] as const) {
      await db.query(sql,params);
      expect((await latest(db,f.link)).enabled,sql).toBe(enabled);
    }
    expect((await latest(db,f.link)).building_id).toBe(SEED.building2);
    await expect(db.query("update audience_connection_event set enabled=false")).rejects.toMatchObject({ code:"42501" });
    const rows=await db.query<{ allowed:boolean }>("select has_table_privilege('authenticated','audience_connection_event','SELECT') as allowed");
    expect(rows[0]?.allowed).toBe(false);
  });
  it("сохраняет закрывающий снимок при каскадном удалении помещения", async () => {
    const db=getDb(),f=await fixture(db);
    await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')",[SEED.testAdminPersonId]);
    const actor=await actorForPerson(db,SEED.testAdminPersonId,true);
    await deleteRegistry({db,audit:new SqlAuditRepo()},actor!,"premises",f.premise);
    expect(await latest(db,f.link)).toMatchObject({ enabled:false,building_id:SEED.building1 });
    expect(await db.query("select id from connection where id=$1",[f.link])).toHaveLength(0);
  });
  it("все изменения одной транзакции имеют одну точку; rollback не оставляет историю", async () => {
    const db=getDb(),f=await fixture(db);
    await db.transaction(async exec => {
      await exec.query("select audience_clock()");
      await exec.query("update connection set status='revoked' where id=$1",[f.link]);
      await exec.query("update connection set status='active' where id=$1",[f.link]);
    });
    const rows=await db.query<{ effective_at:Date }>("select effective_at from audience_connection_event where connection_id=$1 order by id desc limit 2",[f.link]);
    expect(rows[0]?.effective_at).toEqual(rows[1]?.effective_at);
    const before=await db.query("select id from audience_connection_event where connection_id=$1",[f.link]);
    await expect(db.transaction(async exec => { await exec.query("update connection set status='revoked' where id=$1",[f.link]); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await db.query("select id from audience_connection_event where connection_id=$1",[f.link])).toHaveLength(before.length);
  });
  it("корневой gate упорядочивает массовый отзыв и конкурентное восстановление", async () => {
    const db=getDb(), f=await fixture(db);
    let startSecond!: () => void;
    const firstLocked=new Promise<void>(resolve => { startSecond=resolve; });
    let firstAt: number | undefined;
    const first=db.transaction(async exec => {
      const [clock]=await exec.query<{ at:string }>("select (extract(epoch from audience_clock())*1000000)::bigint as at");
      firstAt=Number(clock!.at);
      startSecond();
      await exec.query("select pg_sleep(0.1)");
      await exec.query("update connection set status='revoked' where person_id=$1",[SEED.testExecutorPersonId]);
    });
    const second=(async () => {
      await firstLocked;
      return db.transaction(async exec => {
        const [clock]=await exec.query<{ at:string }>("select (extract(epoch from audience_clock())*1000000)::bigint as at");
        await exec.query("update connection set status='active' where id=$1",[f.link]);
        return Number(clock!.at);
      });
    })();
    const [,secondAt]=await Promise.all([first,second]);
    expect(+secondAt).toBeGreaterThan(+firstAt!);
    expect((await latest(db,f.link)).enabled).toBe(true);
    const history=await loadAudienceIntervals(db,{personId:SEED.testExecutorPersonId,isTest:true,buildingIds:[SEED.building1]});
    expect(audienceEligible(history,secondAt)).toBe(true);
    const states=await db.query<{ enabled:boolean }>("select enabled from audience_connection_event where connection_id=$1 order by effective_at,id",[f.link]);
    expect(states.map(row=>row.enabled)).toEqual([true,false,true]);
  });

  it("штатное удаление здания сохраняет историю всех удалённых помещений", async () => {
    const db=getDb(),f=await fixture(db);
    const actor=await actorForPerson(db,SEED.chairmanPersonId,false);
    const result=await deleteRegistry({db,audit:new SqlAuditRepo()},actor!,"buildings",SEED.building1);
    expect(result.connections).toBe(1);
    expect(await latest(db,f.link)).toMatchObject({enabled:false,building_id:SEED.building1});
    expect(await db.query("select id from premises where id=$1",[f.premise])).toHaveLength(0);
    expect(await db.query("select id from building where id=$1",[SEED.building1])).toHaveLength(0);
  });

});
