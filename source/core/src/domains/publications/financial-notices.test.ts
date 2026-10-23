import { expect, it } from "vitest";
import { noticeAllowed } from "../notifications/service.ts";
import type { DbExecutor } from "../../db/client.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";

it("FIN-02: широкое уведомление требует текущей собственности даже у финансового сотрудника", async () => {
  const actor = makeTestActor("finance", [B1], { isTest: true });
  for (const [owner, state, building] of [[false, "published", B1], [true, "published", B1], [false, "draft", B1], [true, "draft", B1], [true, "published", "another-house"]] as const) {
    const exec: DbExecutor = { async query<T>(sql: string) {
      if (sql.includes("select distinct p.building_id")) return (owner ? [{ building_id: building }] : []) as T[];
      if (sql.includes("distinct on(f.publication_id)")) return (owner ? [{ id: "version" }] : []) as T[];
      if (sql.includes("from publication where")) return [{ id: "publication", kind: "financial_report", state }] as T[];
      if (sql.includes("as ok")) return [{ ok: true }] as T[]; // Действующая связь арендатора тоже есть.
      throw new Error(`Неожиданный SQL: ${sql}`);
    } };
    expect(await noticeAllowed(exec, actor, { publicationId: "publication", isTest: true, audience: "publication", buildingIds: [B1] })).toBe(owner && building === B1);
  }
});
