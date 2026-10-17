import { ApiError } from "../../core/src/errors/api.ts";
import { publicationProblem } from "../../core/src/domains/publications/problems.ts";
import {
  publicationFile,
  selectMedia,
} from "../../core/src/domains/publications/media.ts";
import type { Route, RouteContext } from "./handlers.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
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
export const PUBLICATION_ROUTES: Route[] = [
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
