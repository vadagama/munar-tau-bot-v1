import { expect, it } from "vitest";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { sweepDocumentObligations } from "./jobs.ts";

function fixture(withChairman = true) {
  const rows = ["first", "second"].map(id => ({ id, version: 1, prepared_by: "preparer", request_id: "request", task_id: null,
    is_test: true, due_at: "2026-10-01T00:00:00Z", completed_at: null, reminded_at: null as string | null, escalated_at: null as string | null }));
  const notices = new Map<string, unknown>();
  const db: DbClient = {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (sql.startsWith("select * from document_obligation")) {
        const excluded = (params[0] ?? []) as string[];
        const row = rows.find(r => !excluded.includes(r.id) && (!r.reminded_at || !r.escalated_at));
        return (row ? [row] : []) as T[];
      }
      if (sql.startsWith("select distinct p.id")) return (withChairman ? [{ id: "chair" }] : []) as T[];
      if (sql.startsWith("insert into outbox")) { if (!notices.has(String(params[1]))) notices.set(String(params[1]), JSON.parse(String(params[0]))); return []; }
      const row = rows.find(r => r.id === params[0]);
      if (sql.startsWith("update document_obligation set reminded_at") && row) { row.reminded_at = "now"; return []; }
      if (sql.startsWith("update document_obligation set escalated_at") && row) { row.escalated_at = "now"; return []; }
      throw new Error(`Unsupported SQL in document job fake: ${sql}`);
    },
    transaction: async <T>(fn: (exec: DbExecutor) => Promise<T>) => fn(db),
    close: async () => {},
  };
  return { rows, notices, deps: { db } as RegistryDeps };
}
it("повтор обработчика не удваивает напоминания/эскалации и не меняет срок", async () => {
  const s = fixture();
  expect(await sweepDocumentObligations(s.deps)).toBe(2);
  expect(s.notices.size).toBe(4);
  expect(await sweepDocumentObligations(s.deps)).toBe(0);
  expect(s.notices.size).toBe(4);
  expect(s.rows.every(r => r.due_at === "2026-10-01T00:00:00Z")).toBe(true);
});
it("отсутствие председателя не блокирует напоминания по следующим обязанностям", async () => {
  const s = fixture(false);
  expect(await sweepDocumentObligations(s.deps)).toBe(2);
  expect(s.rows.every(r => !!r.reminded_at && !r.escalated_at)).toBe(true);
  expect(s.notices.size).toBe(2);
});
it("новый цикл обязанности после ошибки документа получает новое напоминание", async () => {
  const s = fixture();
  await sweepDocumentObligations(s.deps);
  s.rows[0]!.version++;
  s.rows[0]!.reminded_at = null; s.rows[0]!.escalated_at = null;
  await sweepDocumentObligations(s.deps);
  expect(s.notices.size).toBe(6);
});
