import { expect, it, vi } from "vitest";
import { documentResource, documentResources } from "./access.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { DocumentRow } from "./types.ts";
import type { Actor } from "../../pdp/types.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";

it("каталог из 500 общих документов не создаёт отдельные SQL-запросы на каждую строку", async () => {
  const query = vi.fn(async () => []);
  const actor = { person: { id: "person", isTest: true } } as Actor;
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: String(i), is_test: true, audience: "resident", published_version_id: "published", task_id: null, request_id: null })) as DocumentRow[];
  const resources = await documentResources({ query } as DbExecutor, actor, rows);
  expect(resources).toHaveLength(500);
  expect(resources.every(r => r.documentAccess?.member && r.documentAccess.sourceAllowed)).toBe(true);
  expect(query.mock.calls.length).toBeLessThanOrEqual(5);
});

it.each(["request", "complaint", "task", "finance"])("пакетный ресурс %s совпадает с одиночным, истёкшая связь не даёт членство", async kind => {
  const actor = makeTestActor("executor", [B1]);
  const request = { id: "r", building_id: B1, author_person_id: "other", state: "in_work", is_test: true,
    complaint_route: kind === "complaint" ? "chairman" : null, complaint_subject_person_id: actor.person.id,
    participant: false, active_author: true };
  const row = { id: "d", task_id: kind === "task" ? "t" : null, request_id: kind === "task" ? null : "r", is_test: true,
    prepared_by: "other", reviewer_id: actor.person.id, audience: kind === "finance" ? "finance" : "resident", published_version_id: "v" } as DocumentRow;
  const task = { id: "t", request_id: "r", is_test: true, assignee_person_id: actor.person.id, building_ids: [B1] };
  const exec: DbExecutor = { async query<T>(sql: string) {
    if (sql.includes("from document_scope")) return [{ document_id: "d", building_id: B1 }] as T[];
    if (sql.includes("from task t")) return [task] as T[];
    if (sql.includes("from task_report")) return [{ task_id: "t", created_by: "previous", author_person_id: "previous" }] as T[];
    if (sql.startsWith("select * from request") || sql.startsWith("select r.*")) return [request] as T[];
    if (sql.includes("as participant")) return [{ participant: false, active_author: true }] as T[];
    if (sql.includes("as member")) return [{ member: false, owner: false }] as T[];
    if (sql.includes("select distinct p.building_id")) return [];
    throw new Error(`Неожиданный SQL: ${sql}`);
  } };
  const [batched] = await documentResources(exec, actor, [row]);
  expect(batched).toEqual(await documentResource(exec, actor, row));
  expect(batched!.documentAccess).toMatchObject({ member: false, owner: false });
});
