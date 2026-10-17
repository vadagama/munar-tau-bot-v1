import type { RuleParams } from "../registry/time.ts";
export type PreferenceMode = "immediate" | "digest" | "off";
export type EventType =
  | "personal"
  | "request.required"
  | "request.status"
  | "request.staff"
  | "publication"
  | "work.report"
  | "incident"
  | "task.assignment";
export function deliveryMode(
  type: EventType,
  mode: PreferenceMode = "immediate",
): PreferenceMode {
  return ["publication", "work.report", "request.status"].includes(type)
    ? (type === "request.status" && mode === "digest" ? "immediate" : mode)
    : "immediate";
}
export function retryPolicy(
  attempts: number,
  error: { retryAfter?: number; blocked?: boolean },
) {
  const retryAfter = Number(error.retryAfter);
  return {
    failed: attempts >= 5 || error.blocked === true,
    delay: Math.max(
      [60, 300, 900, 3600, 21600][Math.min(Math.max(attempts - 1, 0), 4)]!,
      Number.isFinite(retryAfter)
        ? Math.max(0, Math.min(retryAfter, 86400))
        : 0,
    ),
    code: error.blocked ? "BLOCKED_BY_USER" : "DELIVERY_FAILED",
  };
}
/** Ключ локального дня после закрытия смены; изменение графика действует сразу на будущую сводку. */
export function digestWindow(now: Date, schedule: RuleParams): string | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: schedule.timezone ?? "Asia/Almaty",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday!,
  );
  const hour = Number(parts.hour),
    end = schedule.end ?? 20,
    days = schedule.days ?? [0, 1, 2, 3, 4, 5, 6];
  if (hour >= end && days.includes(day)) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  // После простоя ночью завершаем предыдущую смену, в том числе с концом 24:00.
  if (hour < (schedule.start ?? 8) && days.includes((day + 6) % 7)) {
    const previous = new Date(
      Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day) - 1,
      ),
    );
    return previous.toISOString().slice(0, 10);
  }
  return null;
}
