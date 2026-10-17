import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { jsonValue } from "../registry/validation.ts";
import type { RuleParams } from "../registry/time.ts";

export interface LegalLimits {
  min_hours: number;
  max_hours: number;
  clock: "working" | "calendar";
  start?: number;
  end?: number;
  timezone?: string;
  days?: number[];
}
export function validateRuleChange(
  kind: string,
  limits: LegalLimits | null,
  value: unknown,
): asserts value is RuleParams {
  if (!value || typeof value !== "object") {
    throw new ApiError("VALIDATION_FAILED");
  }
  const p = value as RuleParams;
  if (
    !Number.isFinite(p.hours) || p.hours <= 0 || p.hours > 8784 ||
    !["working", "calendar"].includes(p.clock)
  ) throw new ApiError("VALIDATION_FAILED", "Некорректная длительность/отсчёт");
  if (p.clock === "working") {
    const start = p.start ?? 8,
      end = p.end ?? 20,
      days = p.days ?? [0, 1, 2, 3, 4, 5, 6];
    if (
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end > 24 || start >= end || !Array.isArray(days) || !days.length ||
      days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    ) throw new ApiError("VALIDATION_FAILED", "Некорректный график");
    try {
      new Intl.DateTimeFormat("en", { timeZone: p.timezone ?? "Asia/Almaty" })
        .format();
    } catch {
      throw new ApiError("VALIDATION_FAILED", "Некорректный часовой пояс");
    }
  }
  if (kind === "legal") {
    if (
      !limits || !Number.isFinite(limits.min_hours) ||
      !Number.isFinite(limits.max_hours) || p.hours < limits.min_hours ||
      p.hours > limits.max_hours || p.clock !== limits.clock
    ) throw new ApiError("RULE_LEGAL_BOUNDARY");
    if (
      p.clock === "working" &&
      (["start", "end", "timezone", "days"] as const).some((k) =>
        JSON.stringify(p[k]) !== JSON.stringify(limits[k])
      )
    ) throw new ApiError("RULE_LEGAL_BOUNDARY");
  }
}
export function scheduleParams(
  p: RuleParams,
  schedule: RuleParams,
): RuleParams {
  return p.clock === "calendar" ? { ...p } : {
    ...p,
    start: schedule.start,
    end: schedule.end,
    days: schedule.days,
    timezone: schedule.timezone,
  };
}
interface RuleRow {
  id: string;
  key: string;
  kind: string;
  legal_limits: LegalLimits | null;
  params: RuleParams;
  version: number;
  legal_source: string | null;
  legal_revision: string | null;
  legal_effective_from: string | null;
  legal_scope: string | null;
}
/** TIM-04: изменение графика атомарно создаёт будущие версии рабочих правил. */
export async function changeRule(
  deps: RegistryDeps,
  actor: Actor,
  key: string,
  value: unknown,
  reason: string,
) {
  if (
    !can(actor, "registry.rules.edit").allow ||
    !actor.assignments.some((a) =>
      a.role === "chairman" || a.role === "tech_admin" ||
      (a.role === "administrator" && a.regulationsRights)
    )
  ) throw new ApiError("FORBIDDEN");
  if (!reason.trim() || reason.length > 1000) {
    throw new ApiError("VALIDATION_FAILED", "Укажите причину");
  }
  validateRuleChange("operational", null, value);
  return deps.db.transaction(async (exec) => {
    // Единый порядок блокировок для изменения графика и отдельного правила.
    await exec.query("select pg_advisory_xact_lock(814733,5)");
    const rows = await exec.query<RuleRow>(
      `select r.*,v.params,coalesce(v.version,0) as version from time_rule r left join lateral (select params,version from time_rule_version where rule_id=r.id order by version desc limit 1) v on true order by r.key for update of r`,
    );
    const rule = rows.find((r) => r.key === key);
    if (!rule) throw new ApiError("NOT_FOUND");
    if (key === "digest_time") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Время сводки задаётся окончанием рабочего графика",
      );
    }
    if (
      rule.kind === "legal" &&
      (!rule.legal_source || !rule.legal_revision ||
        !rule.legal_effective_from || !rule.legal_scope)
    ) {
      throw new ApiError(
        "RULE_LEGAL_BOUNDARY",
        "Не заполнено правовое основание",
      );
    }
    const schedule = key === "work_schedule" ? value : jsonValue<RuleParams>(
      rows.find((r) => r.key === "work_schedule")!.params,
    );
    if (key === "work_schedule" && value.clock !== "working") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "График должен содержать рабочие интервалы",
      );
    }
    const affected = key === "work_schedule"
      ? rows.filter((r) =>
        r.key === key ||
        (r.kind === "operational" &&
          r.params && jsonValue<RuleParams>(r.params).clock === "working")
      )
      : [rule];
    let result: unknown;
    for (const r of affected) {
      const params = r.kind === "legal" ? value : scheduleParams(
        r.key === key ? value : jsonValue<RuleParams>(r.params),
        schedule,
      );
      validateRuleChange(
        r.kind,
        r.legal_limits ? jsonValue<LegalLimits>(r.legal_limits) : null,
        params,
      );
      const [version] = await exec.query(
        "insert into time_rule_version(rule_id,version,params,created_by,reason,legal_basis) values ($1,$2,$3::text::jsonb,$4,$5,$6::text::jsonb) returning *",
        [
          r.id,
          r.version + 1,
          JSON.stringify(params),
          actor.person.id,
          reason,
          JSON.stringify(
            r.kind === "legal"
              ? {
                source: r.legal_source,
                revision: r.legal_revision,
                effective_from: r.legal_effective_from,
                scope: r.legal_scope,
                limits: r.legal_limits,
              }
              : null,
          ),
        ],
      );
      await recordAudit(
        deps,
        exec,
        actor,
        "registry.rules.edit",
        "time_rule",
        r.id,
        [],
        { version: r.version, params: jsonValue(r.params) },
        version,
        reason,
      );
      if (r.key === key) result = version;
    }
    return result;
  });
}
