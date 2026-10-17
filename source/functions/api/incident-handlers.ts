import { distributeRecovery } from "../../core/src/domains/incidents/recovery.ts";
import {
  acceptSignal,
  assignSignal,
  emergencyContact,
  incidentContext,
  listShifts,
  listSignals,
  saveShift,
  signalEmergency,
} from "../../core/src/domains/incidents/duty.ts";
import type { Route, RouteContext } from "./handlers.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
import {
  createIncident,
  getIncident,
  listIncidents,
  transitionIncident,
} from "../../core/src/domains/incidents/service.ts";
import { linkIncident } from "../../core/src/domains/incidents/links.ts";
const deps = (ctx: RouteContext) => ({
  db: ctx.deps.db,
  audit: ctx.deps.audit,
});
const key = (ctx: RouteContext) => ctx.request.headers.get("idempotency-key");
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
    handler: (ctx) => databaseValidation(() => handler(ctx)),
  };
}
export const INCIDENT_ROUTES: Route[] = [
  route(
    "GET",
    "/v1/incidents/context",
    async (c) => ({ body: await incidentContext(deps(c), c.actor) }),
  ),
  route(
    "POST",
    "/v1/emergency-signals/:id/assign",
    async (c) => ({
      body: await assignSignal(deps(c), c.actor, c.params.id!, c.body, key(c)),
    }),
  ),
  route(
    "GET",
    "/v1/emergency-signals",
    async (c) => ({ body: { items: await listSignals(deps(c), c.actor) } }),
  ),
  route(
    "GET",
    "/v1/duty-shifts",
    async (c) => ({ body: { items: await listShifts(deps(c), c.actor) } }),
  ),
  route(
    "POST",
    "/v1/incidents/:id/distribute",
    async (c) => ({
      body: await distributeRecovery(
        deps(c),
        c.actor,
        c.params.id!,
        c.body,
        key(c),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/emergency/contact",
    async (c) => ({
      body: await emergencyContact(
        c.deps.db,
        c.url.searchParams.get("building_id") ?? "",
        c.actor.person.isTest,
      ),
    }),
  ),
  route(
    "POST",
    "/v1/duty-shifts",
    async (c) => ({
      status: 201,
      body: await saveShift(deps(c), c.actor, c.body, key(c)),
    }),
  ),
  route(
    "POST",
    "/v1/emergency-signals",
    async (c) => ({
      status: 201,
      body: await signalEmergency(deps(c), c.actor, c.body, key(c)),
    }),
  ),
  route(
    "POST",
    "/v1/emergency-signals/:id/accept",
    async (c) => ({
      body: await acceptSignal(deps(c), c.actor, c.params.id!, c.body, key(c)),
    }),
  ),
  route(
    "GET",
    "/v1/incidents",
    async (c) => ({ body: { items: await listIncidents(deps(c), c.actor) } }),
  ),
  route(
    "POST",
    "/v1/incidents",
    async (c) => ({
      status: 201,
      body: await createIncident(deps(c), c.actor, c.body, key(c)),
    }),
  ),
  route(
    "GET",
    "/v1/incidents/:id",
    async (c) => ({ body: await getIncident(deps(c), c.actor, c.params.id!) }),
  ),
  route(
    "POST",
    "/v1/incidents/:id/transitions",
    async (c) => ({
      body: await transitionIncident(
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
    "/v1/incidents/:id/links",
    async (c) => ({
      body: await linkIncident(deps(c), c.actor, c.params.id!, c.body, key(c)),
    }),
  ),
];
