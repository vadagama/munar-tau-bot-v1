import type { Route } from "./handlers.ts";
import {
  listTemplates,
  previewTemplate,
  saveVersion,
  templateVersions,
} from "../../core/src/templates/service.ts";
import { ApiError } from "../../core/src/errors/api.ts";
const read = "settings.templates.read" as const;
export const TEMPLATE_ROUTES: Route[] = [
  {
    method: "GET",
    path: "/v1/templates",
    action: read,
    evaluateAs: "effective",
    handler: async (c) => ({
      body: { items: await listTemplates(c.deps.db, c.actor) },
    }),
  },
  {
    method: "POST",
    path: "/v1/templates/preview",
    action: read,
    evaluateAs: "effective",
    handler: (c) => {
      const key = c.request.headers.get("idempotency-key");
      if (!key?.trim() || key.length > 200) {
        throw new ApiError("VALIDATION_FAILED", "Нужен Idempotency-Key");
      }
      return Promise.resolve({ body: previewTemplate(c.actor, c.body) });
    },
  },
  {
    method: "GET",
    path: "/v1/templates/:key/versions",
    action: read,
    evaluateAs: "effective",
    handler: async (c) => ({
      body: {
        items: await templateVersions(c.deps.db, c.actor, c.params.key!),
      },
    }),
  },
  {
    method: "POST",
    path: "/v1/templates/:key",
    action: "settings.templates.edit",
    evaluateAs: "effective",
    handler: async (c) => ({
      status: 201,
      body: await saveVersion(
        c.deps,
        c.actor,
        c.params.key!,
        c.body,
        c.request.headers.get("idempotency-key"),
      ),
    }),
  },
];
