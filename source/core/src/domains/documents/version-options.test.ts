import { expect, it, vi } from "vitest";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";
import { listDocumentVersionOptions } from "./version-options.ts";
vi.mock("./access.ts", async original => ({ ...await original<typeof import("./access.ts")>(), documentResources: async () => [{ documentAccess: {
  buildingIds: [B1], isTest: true, financial: true, audience: "owner", published: true, owner: true, member: false,
  sourceAllowed: true, sourceManageable: false, preparedById: "preparer", reviewerId: "reviewer", assignedTask: false, resultAuthorIds: [], financialVersionIds: ["v1"],
} }] }));
it("варианты выбора не раскрывают другие проверенные финансовые версии собственнику", async () => {
  const db: DbClient = { async query<T>(sql: string): Promise<T[]> {
    if (sql.includes("from document_version")) return [{ id: "v1", document_id: "doc", version: 1, state: "approved", was_published: false }, { id: "v2", document_id: "doc", version: 2, state: "approved", was_published: false }] as T[];
    return [{ id: "doc", title: "Отчёт", kind: "financial_report", audience: "owner" }] as T[];
  }, transaction: async <T>(fn: (exec: DbExecutor) => Promise<T>) => fn(db), close: async () => {} };
  const actor = makeTestActor("finance", [B1], { isTest: true }), deps = { db } as RegistryDeps;
  expect((await listDocumentVersionOptions(deps, { ...actor, assignments: [] })).items.map(v => v.id)).toEqual(["v1"]);
  expect((await listDocumentVersionOptions(deps, actor)).items.map(v => v.id)).toEqual(["v1", "v2"]);
  await expect(listDocumentVersionOptions(deps, actor, -1)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
