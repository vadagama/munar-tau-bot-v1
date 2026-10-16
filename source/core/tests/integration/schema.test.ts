// Интеграционные тесты схемы: таблицы миграции 0003 существуют, миграции
// применяются повторно без ошибок (идемпотентность — HLD §20, expand/contract).

import { expect, it } from "vitest";

import { describeWithDb } from "./with-db.ts";
import { applyMigrations } from "./helpers.ts";

const REQUIRED_TABLES = [
  "person",
  "profile",
  "building",
  "staff_assignment",
  "staff_scope",
  "access_session",
  "emulation_session",
  "audit_log",
] as const;

describeWithDb("схема БД (миграции VS-1)", (getDb) => {
  it("все таблицы миграции 0003 существуют в схеме public", async () => {
    const rows = await getDb().query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    const names = rows.map((row) => row.tablename);
    for (const table of REQUIRED_TABLES) {
      expect(names, `таблица ${table} отсутствует`).toContain(table);
    }
  });

  it(
    "повторное применение миграций не меняет схему (идемпотентность)",
    async () => {
      const before = await getDb().query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_log'
       order by column_name`,
      );
      await applyMigrations(getDb());
      const after = await getDb().query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_log'
       order by column_name`,
      );
      expect(after).toEqual(before);
    },
    // Повторное применение всех миграций по удалённому пулеру: 40+ операторов,
    // каждый — сетевой round-trip; обычного testTimeout не хватает.
    120_000,
  );
});
