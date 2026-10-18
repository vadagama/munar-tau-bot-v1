import { isUuid } from "../../core/src/bot/text.ts";
import { ApiError } from "../../core/src/errors/api.ts";
import type { RouteContext } from "./handlers.ts";
import type { Route } from "./handlers.ts";
import {
  saveStaffRoles,
  staffCandidates,
  staffDetail,
  staffList,
} from "../../core/src/domains/admin/staff.ts";
function staffId(c: RouteContext): string {
  const id = c.params.id;
  if (!id || !isUuid(id)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Некорректный идентификатор пользователя",
    );
  }
  return id;
}
export const STAFF_ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: "/v1/staff",
    action: "staff.read",
    evaluateAs: "effective",
    handler: async (c) => ({ body: await staffList(c.deps, c.actor) }),
  },
  {
    method: "POST",
    path: "/v1/staff/candidates/search",
    action: "staff.edit",
    evaluateAs: "effective",
    handler: async (c) => {
      if (typeof c.body.query !== "string") {
        throw new ApiError("VALIDATION_FAILED", "Укажите строку поиска");
      }
      return {
        body: { items: await staffCandidates(c.deps, c.actor, c.body.query) },
      };
    },
  },
  {
    method: "GET",
    path: "/v1/staff/:id",
    action: "staff.read",
    evaluateAs: "effective",
    handler: async (c) => ({
      body: await staffDetail(c.deps, c.actor, staffId(c)),
    }),
  },
  {
    method: "POST",
    path: "/v1/staff/:id/roles",
    action: "staff.edit",
    evaluateAs: "effective",
    handler: async (c) => ({
      body: await saveStaffRoles(
        c.deps,
        c.actor,
        staffId(c),
        c.body,
        c.request.headers.get("Idempotency-Key"),
      ),
    }),
  },
];
