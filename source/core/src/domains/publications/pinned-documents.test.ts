import { expect, it, vi } from "vitest";
import { B1, makeTestActor } from "../../testing/actors.ts";
import type { DbExecutor } from "../../db/client.ts";
import { publicationDocumentSelection } from "./pinned-documents.ts";
vi.mock("../documents/access.ts", async original => ({ ...await original<typeof import("../documents/access.ts")>(), documentResources: async () => [true, false].map(sourceAllowed => ({ documentAccess: { buildingIds: [B1], isTest: true, financial: false, audience: "staff", published: false, member: false, owner: false, sourceAllowed, sourceManageable: true, preparedById: "p", reviewerId: "r", assignedTask: false, resultAuthorIds: [] } })) }));
it("восстанавливает точные видимые версии, включая needs_fix, и скрывает недоступный источник", async () => {
  const db: DbExecutor = { async query<T>(sql: string): Promise<T[]> {
    if (sql.includes("from publication_document")) return [{ document_version_id: "visible" }, { document_version_id: "secret" }] as T[];
    if (sql.includes("from document_version v")) return [{ id: "visible", document_id: "doc", version: 2, state: "needs_fix", was_published: false, complete: true }, { id: "secret", document_id: "private", version: 1, state: "approved", complete: true }] as T[];
    return [{ id: "doc", title: "Основание", kind: "decision_basis", audience: "staff" }, { id: "private", title: "Скрытое основание", kind: "decision_basis", audience: "staff" }] as T[];
  } };
  const result = await publicationDocumentSelection(db, makeTestActor("administrator", [B1], { isTest: true }), "pub");
  expect(result).toEqual({ document_version_ids: ["visible"], document_versions: [expect.objectContaining({ id: "visible", title: "Основание", version: 2, available: false })], document_selection_incomplete: true });
  expect(JSON.stringify(result)).not.toContain("Скрытое основание");
  expect(JSON.stringify(result)).not.toContain("secret");
});
