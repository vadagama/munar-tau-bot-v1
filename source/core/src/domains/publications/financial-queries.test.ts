import { expect, it } from "vitest";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
import { getFinancialObligation, listFinancialObligations } from "./financial-queries.ts";
import { listFinancialRules } from "./financial-rules.ts";

function fixture(current = true) {
  const rows = [B1, B2].map((building, i) => ({ id: `duty${i}`, building_ids: [building], is_test: true, active_version_id: "v1", publication_id: "pub", version: 1,
    rule_snapshot: { definition: { channels: ["bot", "site"] } } }));
  const db: DbClient = {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (sql.includes("join financial_rule_version")) return [{ prepared_name: "Подготовитель", reviewer_name: "Проверяющий", publisher_name: "Публикатор", rule_version: 3 }] as T[];
      if (sql.includes("from financial_obligation")) return (sql.includes("where id=$1") ? rows.filter(r => r.id === params[0]) : rows) as T[];
      if (sql.includes("from financial_placement")) return [{ financial_version_id: "v1", channel: "bot" }, { financial_version_id: "old", channel: "site" }] as T[];
      if (sql.includes("from publication")) return [{ financial_version_id: current ? "v1" : "v2" }] as T[];
      throw new Error(`Unexpected financial query: ${sql}`);
    }, transaction: async <T>(fn: (exec: DbExecutor) => Promise<T>) => fn(db), close: async () => {},
  };
  return { deps: { db } as RegistryDeps, rows };
}
it("FIN-04: очередь и карточка следуют финансовой области, а техническая роль не открывает их", async () => {
  const { deps } = fixture(), finance = makeTestActor("finance", [B1], { isTest: true });
  expect((await listFinancialObligations(deps, finance)).items.map(r => r.id)).toEqual(["duty0"]);
  expect((await listFinancialObligations(deps, makeTestActor("tech_admin", [B1], { isTest: true }))).items).toEqual([]);
  await expect(getFinancialObligation(deps, finance, "duty1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await getFinancialObligation(deps, finance, "duty0")).toMatchObject({ can_manage: false, missing_channels: ["site"], prepared_name: "Подготовитель", rule_version: 3 });
  expect(await getFinancialObligation(fixture(false).deps, finance, "duty0")).toMatchObject({ missing_channels: ["bot", "site"] });
});
it("FIN-04: чтение финансового регламента не означает право его редактирования", async () => {
  const db: DbClient = { async query<T>() { return [{ id: "rule", is_test: true, definition: { building_ids: [B1] } }] as T[]; },
    transaction: async <T>(fn: (exec: DbExecutor) => Promise<T>) => fn(db), close: async () => {} };
  const deps = { db } as RegistryDeps;
  expect((await listFinancialRules(deps, makeTestActor("finance", [B1], { isTest: true })))[0]).toMatchObject({ can_manage: false });
  expect((await listFinancialRules(deps, makeTestActor("administrator", [B1], { isTest: true })))[0]).toMatchObject({ can_manage: true });
  expect(await listFinancialRules(deps, makeTestActor("administrator", [B2], { isTest: true }))).toEqual([]);
});
