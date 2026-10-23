import { ApiError } from "../../core/src/errors/api.ts";
import { publicationProblem } from "../../core/src/domains/publications/problems.ts";
import {
  publicationFile,
  selectMedia,
} from "../../core/src/domains/publications/media.ts";
import type { Route, RouteContext } from "./handlers.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
import { listFinancialRules, saveFinancialRule } from "../../core/src/domains/publications/financial-rules.ts";
import { createFinancialObligation, reassignFinancialObligation } from "../../core/src/domains/publications/financial-obligations.ts";
import { listFinancialObligations, getFinancialObligation } from "../../core/src/domains/publications/financial-queries.ts";
import { recordFinancialPlacement } from "../../core/src/domains/publications/financial-placements.ts";
import {
  getPublication,
  listPublications,
  savePublication,
  transitionPublication,
} from "../../core/src/domains/publications/service.ts";
const deps = (c: RouteContext) => ({ db: c.deps.db, audit: c.deps.audit });
const key = (c: RouteContext) => c.request.headers.get("idempotency-key");
function route(
  method: Route["method"],
  path: string,
  handler: Route["handler"],
): Route {
  return {
    method,
    path,
    action: "incident.use",
    evaluateAs: "effective",
    handler: (c) => databaseValidation(() => handler(c)),
  };
}
export const FINANCIAL_ROUTES: Route[] = [
  route("GET", "/v1/financial-rules", async c => ({ body: { items: await listFinancialRules(deps(c), c.actor) } })),
  route("POST", "/v1/financial-rules", async c => ({ status: 201, body: await saveFinancialRule(deps(c), c.actor, null, c.body, key(c)) })),
  route("PATCH", "/v1/financial-rules/:id", async c => ({ body: await saveFinancialRule(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
  route("GET", "/v1/financial-obligations", async c => ({ body: await listFinancialObligations(deps(c), c.actor, Number(c.url.searchParams.get("offset") ?? 0)) })),
  route("POST", "/v1/financial-obligations", async c => ({ status: 201, body: await createFinancialObligation(deps(c), c.actor, c.body, key(c)) })),
  route("GET", "/v1/financial-obligations/:id", async c => ({ body: await getFinancialObligation(deps(c), c.actor, c.params.id!) })),
  route("POST", "/v1/financial-obligations/:id/reassign", async c => ({ body: await reassignFinancialObligation(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
  route("POST", "/v1/financial-obligations/:id/placements", async c => ({ status: 201, body: await recordFinancialPlacement(deps(c), c.actor, c.params.id!, c.body, key(c)) })),
];
export const PUBLICATION_ROUTES: Route[] = [
  ...FINANCIAL_ROUTES,
  route(
    "POST",
    "/v1/publications/:id/problems",
    async (c) => ({
      status: 201,
      body: await publicationProblem(
        deps(c),
        c.actor,
        c.params.id!,
        c.body,
        key(c),
      ),
    }),
  ),
  route(
    "POST",
    "/v1/publications/:id/media",
    async (c) => ({
      body: await selectMedia(deps(c), c.actor, c.params.id!, c.body, key(c)),
    }),
  ),
  route("GET", "/v1/publications/:id/files/:fileId/url", async (c) => {
    if (!c.deps.storage) throw new ApiError("INTERNAL");
    return {
      body: await publicationFile(
        deps(c),
        c.deps.storage,
        c.actor,
        c.params.id!,
        c.params.fileId!,
      ),
    };
  }),
  route(
    "GET",
    "/v1/publications",
    async (c) => ({
      body: { items: await listPublications(deps(c), c.actor) },
    }),
  ),
  route(
    "POST",
    "/v1/publications",
    async (c) => ({
      status: 201,
      body: await savePublication(deps(c), c.actor, null, c.body, key(c)),
    }),
  ),
  route(
    "GET",
    "/v1/publications/:id",
    async (c) => ({
      body: await getPublication(deps(c), c.actor, c.params.id!),
    }),
  ),
  route(
    "PATCH",
    "/v1/publications/:id",
    async (c) => ({
      body: await savePublication(
        deps(c),
        c.actor,
        c.params.id!,
        c.body,
        key(c),
      ),
    }),
  ),
  route(
    "POST",
    "/v1/publications/:id/transitions",
    async (c) => ({
      body: await transitionPublication(
        deps(c),
        c.actor,
        c.params.id!,
        c.body,
        key(c),
      ),
    }),
  ),
];
