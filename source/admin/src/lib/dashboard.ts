import { useEffect, useRef, useState } from "react";
import type { DashboardWidget } from "../../../core/src/domains/dashboard/service";
import type { DashboardPeriod, PeriodBucket } from "../../../core/src/domains/dashboard/period";
import { apiFetch } from "./api";
import { useCabinetIdentity } from "./identity";
import { usePageRefresh } from "./use-page-refresh";
export type { DashboardWidget, DashboardPeriod };
export interface DashboardResponse {
  widgets: DashboardWidget[]; analytics: boolean; registration_analytics?: boolean;
  assistant: { state: "disabled" | "limit" | "unavailable" };
  generated_at: string;
}
export interface DashboardAnalytics {
  period: DashboardPeriod; from: string; to: string;
  buckets: Array<PeriodBucket & { created: number; closed: number }>;
  kinds: Array<{ kind: string; count: number }>;
}
export interface DashboardTasksAnalytics {
  period: DashboardPeriod; from: string; to: string;
  buckets: Array<PeriodBucket & { created: number; accepted: number }>;
  states: Array<{ state: string; count: number }>;
}
export interface DashboardQualityAnalytics {
  period: DashboardPeriod; from: string; to: string;
  buckets: Array<PeriodBucket & {
    requests_late: number; accepted_late: number;
    median_hours: number | null; avg_rating: number | null; rated: number;
  }>;
}
export interface DashboardTasksWorkload {
  workload: Array<{ person_id: string | null; name: string; open: number; overdue: number }>;
}
export interface DashboardIncidentsAnalytics {
  period: DashboardPeriod; from: string; to: string;
  buckets: Array<PeriodBucket & { created: number; completed: number }>;
}
export interface DashboardRegistrationsAnalytics {
  period: DashboardPeriod; from: string; to: string;
  buckets: Array<PeriodBucket & { primary: number; binding: number }>;
}
export function useDashboardIdentity() {
  const { identity, roles } = useCabinetIdentity();
  const me = identity?.me;
  return { identity, key: me ? `${me.profile.id}:${me.person.id}:${me.person.is_test}:${me.emulation?.session_id ?? "real"}:${roles.slice().sort().join(",")}` : "" };
}
/** Keys are checked during render as well as resolution: never paint another actor's snapshot. */
export function useDashboardResource<T>(path: string | null) {
  const { key } = useDashboardIdentity();
  const resourceKey = `${key}:${path}`;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  const load = async () => {
    const current = ++generation.current;
    if (!key || !path) return;
    try {
      const data = await apiFetch<T>(path);
      if (current === generation.current) setSnapshot({ key: resourceKey, data });
    } catch (e) {
      if (current === generation.current) setSnapshot({ key: resourceKey, error: e instanceof Error ? e.message : "Не удалось загрузить данные" });
    }
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, [resourceKey]);
  usePageRefresh(load, !!key && !!path);
  const current = snapshot.key === resourceKey ? snapshot : undefined;
  return { data: current?.data, error: current?.error, loading: !!path && !!key && !current, reload: load };
}
export interface DashboardPreferences { order: string[]; hidden: string[]; limits: Record<string, number> }
export const dashboardDefaults = (): DashboardPreferences => ({ order: ["new", "action", "registrations", "bindings", "tasks", "incidents", "flow", "kinds", "task-flow", "task-states", "lead", "overdue", "rating", "task-load", "incident-flow", "registrations-flow"], hidden: [], limits: {} });
export function parseDashboardPreferences(raw: string | null): DashboardPreferences {
  const base = dashboardDefaults();
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || !Array.isArray(v.order) || !Array.isArray(v.hidden)) return base;
    const valid = (x: unknown): x is string => typeof x === "string" && base.order.includes(x);
    return { order: [...new Set([...v.order.filter(valid), ...base.order])], hidden: v.hidden.filter(valid),
      limits: Object.fromEntries(Object.entries(v.limits ?? {}).filter(([id, n]) => valid(id) && [3, 5, 10, 20].includes(Number(n))).map(([id,n]) => [id, Number(n)])) };
  } catch { return base; }
}
export function moveWidget(order: string[], from: string, to: string): string[] {
  const result = [...order], at = result.indexOf(from), target = result.indexOf(to);
  if (at < 0 || target < 0) return result;
  result.splice(at, 1); result.splice(target, 0, from); return result;
}
export function analyticsLink(period: string, from: string, to: string, measure: string, kind?: string) {
  const query = new URLSearchParams({ dashboard: "1", period, from, until: to, measure });
  if (kind) query.set("kind", kind);
  return `/requests?${query}`;
}
