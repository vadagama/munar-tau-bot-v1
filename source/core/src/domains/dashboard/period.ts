import { ApiError } from "../../errors/api.ts";
export type DashboardPeriod = "day" | "week" | "month" | "year";
export interface PeriodBucket { label: string; from: string; to: string }
const stamp = (d: Date) => `${d.toISOString().slice(0, 19)}+05:00`;
/** Half-open Almaty calendar intervals, independent of host/browser timezone. */
export function dashboardPeriod(value: unknown, now = new Date()) {
  if (!["day", "week", "month", "year"].includes(String(value))) {
    throw new ApiError("VALIDATION_FAILED", "Неизвестный период");
  }
  const period = value as DashboardPeriod;
  const local = new Date(now.getTime() + 5 * 3600_000);
  local.setUTCHours(0, 0, 0, 0);
  if (period === "week") local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  if (period === "month") local.setUTCDate(1);
  if (period === "year") local.setUTCMonth(0, 1);
  const start = new Date(local);
  const end = new Date(local);
  if (period === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (period === "week" ? 7 : 1));
  const buckets: PeriodBucket[] = [];
  while (local < end) {
    const next = new Date(local);
    if (period === "year") next.setUTCMonth(next.getUTCMonth() + 1);
    else if (period === "day") next.setUTCHours(next.getUTCHours() + 6);
    else next.setUTCDate(next.getUTCDate() + (period === "month" ? 7 : 1));
    if (next > end) next.setTime(end.getTime());
    const label = period === "year" ? local.toLocaleString("ru-RU", { month: "short", timeZone: "UTC" })
      : period === "day" ? `${local.getUTCHours()}–${next.getTime() === end.getTime() ? 24 : next.getUTCHours()}`
      : `${local.getUTCDate()}.${local.getUTCMonth() + 1}`;
    buckets.push({ label, from: stamp(local), to: stamp(next) });
    local.setTime(next.getTime());
  }
  return { period, from: stamp(start), to: stamp(end), buckets };
}
