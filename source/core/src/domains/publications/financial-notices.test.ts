import { expect, it } from "vitest";
import { noticeAllowed, type NoticeOptions } from "../notifications/service.ts";
import type { DbExecutor } from "../../db/client.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";

it("FIN-04: уведомление обязанности проверяет режим, полномочия и актуального ответственного повторно", async () => {
  const actor = makeTestActor("finance", [B1], { isTest: true });
  const options = { financialObligationId: "duty", isTest: true } as NoticeOptions;
  for (const patch of [{}, { completed_at: "done" }, { is_test: false }, { prepared_by: "new-person" }, { building_ids: ["other-house"] }]) {
    const row = { building_ids: [B1], is_test: true, completed_at: null, prepared_by: actor.person.id, reviewer_id: "reviewer", publisher_id: "publisher", ...patch };
    const exec: DbExecutor = { async query<T>() { return [row] as T[]; } };
    expect(await noticeAllowed(exec, actor, options)).toBe(Object.keys(patch).length === 0);
  }
  const exec: DbExecutor = { async query<T>() { return [{ building_ids: [B1], is_test: true, completed_at: null, prepared_by: actor.person.id }] as T[]; } };
  expect(await noticeAllowed(exec, { ...actor, assignments: [] }, options)).toBe(false);
});

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
