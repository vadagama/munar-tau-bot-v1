import { expect, it } from "vitest";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { sweepFinancialObligations } from "./financial-jobs.ts";

function fixture(withChairman = true) {
  const rows = ["first", "second"].map(id => ({ id, version: 1, prepared_by: "preparer", reviewer_id: "chair", publisher_id: "preparer",
    is_test: true, due_at: "2026-10-01T00:00:00Z", completed_at: null, reminded_at: null as string | null, escalated_at: null as string | null }));
  const notices = new Map<string, Record<string, unknown>>();
  const db: DbClient = {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (sql.startsWith("select * from financial_obligation")) {
        const excluded = params[0] as string[];
        const row = rows.find(r => !excluded.includes(r.id) && (!r.reminded_at || !r.escalated_at));
        return (row ? [row] : []) as T[];
      }
      if (sql.startsWith("select distinct p.id")) return (withChairman ? [{ id: "chair" }] : []) as T[];
      if (sql.startsWith("insert into outbox")) { notices.set(String(params[1]), JSON.parse(String(params[0]))); return []; }
      const row = rows.find(r => r.id === params[0]);
      if (sql.startsWith("update financial_obligation set reminded_at") && row) { row.reminded_at = "now"; return []; }
      if (sql.startsWith("update financial_obligation set escalated_at") && row) { row.escalated_at = "now"; return []; }
      throw new Error(`Unexpected financial sweep SQL: ${sql}`);
    },
    transaction: async <T>(fn: (exec: DbExecutor) => Promise<T>) => fn(db), close: async () => {},
  };
  return { rows, notices, deps: { db } as RegistryDeps };
}
it("FIN-04: напоминания и эскалация ограничены, дедуплицированы и не сдвигают срок", async () => {
  const s = fixture();
  expect(await sweepFinancialObligations(s.deps)).toBe(2);
  expect(s.notices.size).toBe(4); // Совмещение обязанностей не умножает сообщения человеку.
  expect(await sweepFinancialObligations(s.deps)).toBe(0);
  expect(s.notices.size).toBe(4);
  expect([...s.notices.values()].every(n => n.isTest === true && n.bot === "worker" && n.important === true && n.financialObligationId)).toBe(true);
  expect(s.rows.every(r => r.due_at === "2026-10-01T00:00:00Z")).toBe(true);
});
it("FIN-04: отсутствие председателя не задерживает следующие обязанности; новый цикл получает новое напоминание", async () => {
  const s = fixture(false);
  expect(await sweepFinancialObligations(s.deps)).toBe(2);
  expect(s.rows.every(r => !!r.reminded_at && !r.escalated_at)).toBe(true);
  s.rows[0]!.version++; s.rows[0]!.reminded_at = null;
  await sweepFinancialObligations(s.deps);
  expect(s.notices.size).toBe(6);
  expect(await sweepFinancialObligations(s.deps, Date.now())).toBe(0);
});
