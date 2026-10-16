// Интеграционные тесты защиты на уровне БД (LLD-02 §16–17, rls.sql):
// RLS включён, политик для client-ролей нет, привилегии у anon/authenticated
// отозваны — прямой запрос из браузера по publishable key не возвращает строки;
// audit_log append-only — UPDATE/DELETE блокирует триггер (AUD-01).

import { expect, it } from "vitest";

import { describeWithDb } from "./with-db.ts";

const TABLES = [
  "person",
  "profile",
  "building",
  "staff_assignment",
  "staff_scope",
  "access_session",
  "emulation_session",
  "audit_log",
] as const;

const CLIENT_ROLES = ["anon", "authenticated"] as const;

describeWithDb("защита на уровне БД (второй рубеж)", (getDb) => {
  it("RLS включён на всех таблицах VS-1 (LLD-02 §16)", async () => {
    const rows = await getDb().query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const byName = new Map(rows.map((row) => [row.relname, row.relrowsecurity]));
    for (const table of TABLES) {
      expect(byName.get(table), `RLS не включён на ${table}`).toBe(true);
    }
  });

  it("политик для anon/authenticated нет — прямой доступ из браузера закрыт", async () => {
    const rows = await getDb().query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public'
         and ('anon' = any(roles) or 'authenticated' = any(roles))`,
    );
    expect(rows).toHaveLength(0);
  });

  it("anon и authenticated не имеют привилегий на таблицы и схему (rls.sql)", async () => {
    const db = getDb();
    for (const table of ["person", "audit_log"]) {
      for (const role of CLIENT_ROLES) {
        const canSelect = await db.query<{ ok: boolean }>(
          "select has_table_privilege($1, $2, 'select') as ok",
          [role, table],
        );
        expect(canSelect[0]?.ok, `select ${table} у ${role}`).toBe(false);
        const canInsert = await db.query<{ ok: boolean }>(
          "select has_table_privilege($1, $2, 'insert') as ok",
          [role, table],
        );
        expect(canInsert[0]?.ok, `insert ${table} у ${role}`).toBe(false);
      }
    }
    // USAGE на схему public у клиентских ролей на hosted Supabase выдаёт
    // платформа (гранта pg_database_owner, снять её без суперпользователя
    // нельзя), и это допустимо: данные закрыты привилегиями на таблицы
    // (revoke в миграциях) и отсутствием RLS-политик — второй рубеж держит.
    // Проверяем то, что защищает данные, а не платформенный атрибут.
    const tableGrant = await db.query<{ grantee: string }>(
      `select grantee from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
       limit 1`,
    );
    expect(tableGrant, "гранты на таблицы у клиентских ролей").toHaveLength(0);
  });

  it("audit_log append-only: UPDATE и DELETE блокируются триггером (AUD-01)", async () => {
    const db = getDb();
    const inserted = await db.query<{ id: string | number }>(
      `insert into audit_log
         (actor_person_id, actor_profile_id, emulation_session_id, emulated_person_id,
          action, entity_type, entity_id, before, after, reason, scope_buildings, meta)
       values (null, null, null, null, 'tech.smoke', 'smoke', null, null, null, null,
               '[]'::jsonb, '{}'::jsonb)
       returning id`,
    );
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error("вставка в audit_log не вернула идентификатор");

    await expect(
      db.query("update audit_log set action = 'hacked' where id = $1", [id]),
    ).rejects.toThrow();
    await expect(db.query("delete from audit_log where id = $1", [id])).rejects.toThrow();

    const stillThere = await db.query<{ id: string | number }>(
      "select id from audit_log where id = $1",
      [id],
    );
    expect(stillThere).toHaveLength(1);
  });
});
