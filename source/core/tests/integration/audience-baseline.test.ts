import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";

const migration=readFileSync(new URL("../../../db/migrations/20261023101000_vs8_audience_history.sql",import.meta.url),"utf8");
describeWithDb("POL начало истории",getDb=>{
  it("снимает baseline существующей связи без выдуманного прошлого; replay не дублирует снимок",async()=>{
    const db=getDb();
    const [premise]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','baseline',true) returning id",[SEED.building1]);
    const [link]=await db.query<{id:string}>("insert into connection(person_id,premises_id,role,basis,status,start_date) values($1,$2,'owner','ownership','active','2020-01-01') returning id",[SEED.testExecutorPersonId,premise!.id]);
    const [meta]=await db.query<{starts_at:Date}>("select starts_at from audience_history_meta");
    // Имитация внедрения над старым реестром, только под эксклюзивным Sydney test lock.
    await db.query("truncate audience_connection_event");
    const [before]=await db.query<{at:Date}>("select clock_timestamp() as at");
    await db.query(migration);
    await db.query(migration);
    const events=await db.query<{enabled:boolean;effective_at:Date}>("select enabled,effective_at from audience_connection_event where connection_id=$1",[link!.id]);
    expect(events).toHaveLength(1);
    expect(events[0]?.enabled).toBe(true);
    expect(+events[0]!.effective_at).toBeGreaterThanOrEqual(+before!.at);
    expect(await db.query("select starts_at from audience_history_meta")).toEqual([meta]);
  });
});
