import type { Route, RouteContext } from "./handlers.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
import { createDocument, addDocumentVersion, transitionDocumentVersion, publishDocument, listDocuments, getDocument } from "../../core/src/domains/documents/service.ts";
import { listDocumentVersionOptions } from "../../core/src/domains/documents/version-options.ts";
import { listTaskAssignees } from "../../core/src/domains/tasks/assignees.ts";
import { can } from "../../core/src/pdp/evaluate.ts";
import { ApiError } from "../../core/src/errors/api.ts";
import { createObligation, listObligations, fulfillObligation, reassignObligation } from "../../core/src/domains/documents/obligations.ts";
const deps = (c: RouteContext) => ({ db: c.deps.db, audit: c.deps.audit });
const key = (c: RouteContext) => c.request.headers.get("idempotency-key");
function route(method: Route["method"], path: string, handler: Route["handler"]): Route {
  return { method, path, action: "document.use", evaluateAs: "effective", handler: c => databaseValidation(() => handler(c)) };
}
export const DOCUMENT_ROUTES: Route[] = [
  route("GET", "/v1/documents/version-options", async c => ({ body: await listDocumentVersionOptions(deps(c), c.actor, Number(c.url.searchParams.get("offset") ?? 0)) })),
  route("GET", "/v1/documents/obligations", async c => ({ body: await listObligations(deps(c), c.actor, { requestId: c.url.searchParams.get("request_id") ?? undefined, taskId: c.url.searchParams.get("task_id") ?? undefined }) })),
  route("POST", "/v1/documents/obligations", async c => ({ status: 201, body: await createObligation(deps(c), c.actor, c.body, key(c)) })),
  route("POST", "/v1/documents/obligations/:id/fulfill", async c => ({ body: await fulfillObligation(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
  route("POST", "/v1/documents/obligations/:id/reassign", async c => ({ body: await reassignObligation(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
  route("GET", "/v1/documents/candidates", async c => {
    if (!can(c.actor, "registry.read").allow) throw new ApiError("FORBIDDEN");
    return { body: { items: await listTaskAssignees(c.deps.db, c.actor.person.isTest, []) } };
  }),
  route("GET", "/v1/documents", async c => ({ body: await listDocuments(deps(c), c.actor, Number(c.url.searchParams.get("offset") ?? 0)) })),
  route("POST", "/v1/documents", async c => ({ status: 201, body: await createDocument(deps(c), c.actor, c.body, key(c)) })),
  route("GET", "/v1/documents/:id", async c => ({ body: await getDocument(deps(c), c.actor, c.params.id!) })),
  route("POST", "/v1/documents/:id/versions", async c => ({ status: 201, body: await addDocumentVersion(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
  ...["submit", "approve", "return", "needs-fix"].map(action => route("POST", `/v1/documents/:id/versions/:v/${action}`, async c => ({
    body: await transitionDocumentVersion(deps(c), c.actor, c.params.id!, Number(c.params.v), action.replace("-", "_"), c.body, key(c)),
  }))),
  route("POST", "/v1/documents/:id/publish", async c => ({ body: await publishDocument(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
];
