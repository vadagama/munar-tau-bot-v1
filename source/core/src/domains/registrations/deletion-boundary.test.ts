import { expect, it } from "vitest";
import { acceptInvite } from "./service.ts";
import { mutateRegistry, type RegistryDeps } from "../registry/service.ts";
import { makeTestActor } from "../../testing/actors.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
const actor = makeTestActor("chairman", []);
function archivedPerson() {
  const writes: string[] = [];
  const exec: DbExecutor = { query: async <T>(sql: string) => {
    if (sql.startsWith("select * from invite")) return [{ id: "invite", status: "active", expires_at: "2099-01-01", created_by: "owner", premises_id: "p1", role: "tenant" }] as T[];
    if (sql.startsWith("select id from connection") && sql.includes("role='owner'")) return [{ id: "owner-link" }] as T[];
    if (sql.startsWith("select") && sql.includes("from person")) return [{ id: actor.person.id, status: "archived", is_test: false }] as T[];
    if (sql.startsWith("select * from premises")) return [{ id: "p1", building_id: "b1", kind: "apartment", is_test: false, status: "active" }] as T[];
    if (!sql.startsWith("select")) writes.push(sql);
    return [];
  } };
  const db: DbClient = { ...exec, transaction: fn => fn(exec), close: async () => {} };
  return { deps: { db } as RegistryDeps, writes };
}
it("начатое до удаления принятие приглашения не создаёт новую связь архивному человеку", async () => {
  const h = archivedPerson();
  await expect(acceptInvite(h.deps, actor, "token")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(h.writes).toEqual([]);
});
it("реестр не создаёт новую связь архивному человеку после удаления анкеты", async () => {
  const h = archivedPerson();
  await expect(mutateRegistry(h.deps, actor, "connections", { person_id: actor.person.id, premises_id: "p1", role: "owner", basis: "ownership" }))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(h.writes).toEqual([]);
});
