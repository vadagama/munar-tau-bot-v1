import type { Route } from "./handlers.ts";
import {
  getPreferences,
  setPreference,
} from "../../core/src/domains/notifications/service.ts";
import {
  completeFollowup,
  listFailures,
} from "../../core/src/domains/notifications/followup.ts";
export const NOTIFICATION_ROUTES: Route[] = [
  {
    method: "GET",
    path: "/v1/notifications/preferences",
    action: "notification.preferences",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await getPreferences(ctx.deps.db, ctx.actor),
    }),
  },
  {
    method: "POST",
    path: "/v1/notifications/preferences",
    action: "notification.preferences",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await setPreference(
        ctx.deps,
        ctx.actor,
        ctx.body.event_type,
        ctx.body.mode,
        ctx.body.language,
      ),
    }),
  },
  {
    method: "GET",
    path: "/v1/notifications/failures",
    action: "notification.failures",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await listFailures(ctx.deps.db, ctx.actor),
    }),
  },
  {
    method: "POST",
    path: "/v1/notifications/followups/:id/complete",
    action: "notification.failures",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await completeFollowup(
        ctx.deps,
        ctx.actor,
        ctx.params.id!,
        ctx.body.result,
      ),
    }),
  },
];
