import type { Route } from "./handlers.ts";
import { dashboardAnalytics, dashboardRequests, getDashboard } from "../../core/src/domains/dashboard/service.ts";
export const DASHBOARD_ROUTES: Route[] = [
  { method: "GET", path: "/v1/dashboard", action: "meta.me", evaluateAs: "effective", handler: async ctx => ({ body: await getDashboard(ctx.deps, ctx.actor) }) },
  { method: "GET", path: "/v1/dashboard/analytics", action: "meta.me", evaluateAs: "effective", handler: async ctx => ({ body: await dashboardAnalytics(ctx.deps, ctx.actor, ctx.url.searchParams.get("period") ?? "month") }) },
  { method: "POST", path: "/v1/dashboard/requests", action: "meta.me", evaluateAs: "effective", handler: async ctx => {
    return { body: await dashboardRequests(ctx.deps, ctx.actor, ctx.body) };
  } },
];
