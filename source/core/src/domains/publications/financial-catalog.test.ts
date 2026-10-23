import { expect, it } from "vitest";
import type { DbExecutor } from "../../db/client.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
import { listFinancialCatalogue } from "./financial-catalog.ts";
it("каталог берёт выпущенные версии, проверяет PDP до страницы и сохраняет старый выпуск при черновике исправления", async () => {
  const query: string[] = [];
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: `hidden${i}`, publication_id: `hidden${i}`, title: "Чужой выпуск", building_ids: [B2], is_test: true, version: 1, published_at: "2026-10-02" }));
  rows.push({ id: "old", publication_id: "pub", title: "Опубликованный отчёт", building_ids: [B1], is_test: true, version: 1, published_at: "2026-10-01" });
  const db: DbExecutor = { async query<T>(sql: string): Promise<T[]> { query.push(sql); if (sql.includes("from financial_publication_version")) return rows as T[]; if (sql.includes("select distinct p.building_id")) return [{ building_id: B1 }] as T[]; throw new Error(`Нет обращения к общему каталогу публикаций: ${sql}`); } };
  const actor = makeTestActor("finance", [B1], { isTest: true });
  expect(await listFinancialCatalogue(db, actor, "staff")).toMatchObject({ items: [{ id: "old", publication_id: "pub", title: "Опубликованный отчёт" }], has_more: false });
  expect(await listFinancialCatalogue(db, { ...actor, assignments: [] }, "owner")).toMatchObject({ items: [{ id: "old" }] });
  expect(query.some(sql => /limit\s+200/i.test(sql))).toBe(false);
});
it("сотрудник без собственности не получает роль собственника в боте жителя", async () => {
  const db: DbExecutor = { async query<T>(sql: string): Promise<T[]> { return (sql.includes("from financial_publication_version") ? [{ id: "v", publication_id: "pub", title: "Отчёт", building_ids: [B1], is_test: true, version: 1, published_at: "2026-10-01" }] : []) as T[]; } };
  expect((await listFinancialCatalogue(db, makeTestActor("finance", [B1], { isTest: true }), "owner")).items).toEqual([]);
});
