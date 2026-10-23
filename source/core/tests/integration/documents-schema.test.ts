import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";

describeWithDb("VS-8: схема документов и RLS", getDb => {
  it("закрывает прямой доступ клиентам на каждую новую таблицу", async () => {
    const rows = await getDb().query<{ relname: string; relrowsecurity: boolean; exposed: boolean }>(
      `select c.relname,c.relrowsecurity,
       has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT') as exposed
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1::text[])`,
      [["document", "document_scope", "document_version", "document_log", "document_obligation"]],
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, exposed: false });
  });
  it("запрещает изменить и удалить историю", async () => {
    const db = getDb();
    const [doc] = await db.query<{ id: string }>(
      `insert into document(title,kind,audience,document_date,prepared_by,reviewer_id,created_by,is_test)
       values('Тест','act','staff',current_date,$1,$2,$1,true) returning id`,
      [SEED.testExecutorPersonId, SEED.testAdminPersonId],
    );
    const [event] = await db.query<{ id: string }>(
      "insert into document_log(document_id,action,actor_person_id,reason) values($1,'created',$2,'Тест') returning id",
      [doc!.id, SEED.testAdminPersonId],
    );
    await expect(db.query("update document_log set reason='Подмена' where id=$1", [event!.id])).rejects.toThrow();
    await expect(db.query("delete from document_log where id=$1", [event!.id])).rejects.toThrow();
  });
});
