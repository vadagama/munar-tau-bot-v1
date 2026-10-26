import {ruleContract} from "../timing/contracts.ts";
import { validateRuleChange } from "../timing/rules.ts";
import { jsonValue } from "./validation.ts";
import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
export interface RuleParams {
  hours: number;
  clock: "calendar" | "working";
  start?: number;
  end?: number;
  timezone?: string;
  days?: number[];
}
export function addRuleHours(from: Date, p: RuleParams): Date {
  validateRuleChange("operational", null, p);
  if (!Number.isFinite(from.getTime())) throw new ApiError("VALIDATION_FAILED", "Некорректная дата");
  if (!Number.isFinite(p.hours) || p.hours <= 0 || p.hours > 24 * 366)
    throw new ApiError("VALIDATION_FAILED", "Некорректная длительность");
  if (p.clock === "calendar")
    return new Date(from.getTime() + p.hours * 3600000);
  const start = p.start ?? 8,
    end = p.end ?? 20;
  if (
    start < 0 ||
    end > 24 ||
    start >= end ||
    !Number.isInteger(start) ||
    !Number.isInteger(end)
  )
    throw new ApiError("VALIDATION_FAILED", "Некорректный график");
  const zone = p.timezone ?? "Asia/Almaty";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const days = p.days ?? [0, 1, 2, 3, 4, 5, 6];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    throw new ApiError("VALIDATION_FAILED", "Некорректные рабочие дни");
  let cursor = from.getTime(),
    remaining = p.hours * 3600000;
  // Минутные сегменты сохраняют секунды и точный край графика в любом IANA TZ.
  while (remaining > 0) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(cursor)).map((v) => [v.type, v.value]),
    );
    const h = Number(parts.hour),
      m = Number(parts.minute),
      s = Number(parts.second);
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday!,
    );
    const working = days.includes(day) && h * 60 + m >= start * 60 && h * 60 + m < end * 60;
    const segment = Math.min(60000 - (s * 1000 + (cursor % 1000)), working ? remaining : Infinity);
    if (working) remaining -= segment;
    cursor += segment;
  }
  return new Date(cursor);
}
export async function ruleDeadline(
  exec: DbExecutor,
  key: string,
  from = new Date(),
): Promise<{ id: string; due: Date; starts: Date }> {
  const [version] = await exec.query<{ id: string; params: RuleParams }>(
    "select v.id,v.params from time_rule_version v join time_rule r on r.id=v.rule_id where r.key=$1 order by v.version desc limit 1",
    [key],
  );
  if (!version)
    throw new ApiError("VALIDATION_FAILED", `Не настроен регламент ${key}`);
  ruleContract(key, version.params);
  return {
    id: version.id,
    due: addRuleHours(from, jsonValue<RuleParams>(version.params)),
    starts: nextWorkingStart(from, jsonValue<RuleParams>(version.params)),
  };
}
export async function startTimer(
  exec: DbExecutor,
  key: string,
  entityId: string,
  stage: string,
  from = new Date(),
): Promise<Date> {
  const deadline = await ruleDeadline(exec, key, from);
  const rows = await exec.query<{due_at:string}>(
    "insert into timer(rule_version_id,entity_id,stage,due_at) values ($1,$2,$3,$4) on conflict (entity_id,stage) do update set rule_version_id=excluded.rule_version_id,due_at=excluded.due_at,state='pending',fired_at=null where timer.state<>'pending' returning due_at",
    [deadline.id, entityId, stage, deadline.due.toISOString()],
  );
  if (rows[0]) return new Date(rows[0].due_at);
  const [existing]=await exec.query<{due_at:string}>("select due_at from timer where entity_id=$1 and stage=$2",[entityId,stage]);
  return new Date(existing!.due_at);
}

export function nextWorkingStart(from: Date, params: RuleParams): Date {
  return params.clock === "calendar" ? from : new Date(addRuleHours(from,{...params,hours:1/3600000}).getTime()-1);
}
