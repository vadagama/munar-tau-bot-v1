import type { EnvSource } from "../../config/env.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { buildAuditInput } from "../audit/entry.ts";
import { getDashboard } from "./service.ts";
import { deepseekAnswer } from "./assistant-provider.ts";
export interface AssistantConfig { apiKey: string; profileIds: readonly string[] }
export type AssistantStatus = { state: "disabled" } | { state: "unavailable" } | { state: "enabled" | "limit"; remaining: number | null; daily_limit: number | null };
export function assistantConfig(env: EnvSource): AssistantConfig | undefined {
  const apiKey = env("DEEPSEEK_API_KEY")?.trim();
  const profileIds = (env("AI_ENABLED_PROFILE_IDS") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  return apiKey && profileIds.length ? { apiKey, profileIds } : undefined;
}
function allowed(actor: Actor, config?: AssistantConfig): config is AssistantConfig {
  return !!config?.apiKey && config.profileIds.includes(actor.profile.id) && actor.person.status === "active" && !actor.person.isTest && !actor.emulation;
}
const unlimited = (actor: Actor) => actor.assignments.some(a => a.role === "tech_admin");
export async function assistantStatus(deps: RegistryDeps, actor: Actor, config?: AssistantConfig): Promise<AssistantStatus> {
  if (!allowed(actor, config)) return { state: "disabled" };
  if (unlimited(actor)) return { state: "enabled", remaining: null, daily_limit: null };
  try {
    const rows = await deps.db.query<{ used: number }>(`select used from dashboard_ai_quota where profile_id=$1 and day=(now() at time zone 'Asia/Almaty')::date`, [actor.profile.id]);
    const remaining = Math.max(0, 20 - Number(rows[0]?.used ?? 0));
    return { state: remaining ? "enabled" : "limit", remaining, daily_limit: 20 };
  } catch { return { state: "unavailable" }; }
}
/** Shared across isolates/tabs. Failed paid attempts are deliberately not refunded. */
export async function reserveAssistantRequest(deps: RegistryDeps, actor: Actor): Promise<number | null> {
  if (unlimited(actor)) return null;
  const rows = await deps.db.query<{ used: number }>(`insert into dashboard_ai_quota(profile_id,day,used)
    values ($1,(now() at time zone 'Asia/Almaty')::date,1)
    on conflict (profile_id) do update set
      used=case when dashboard_ai_quota.day < excluded.day then 1 else dashboard_ai_quota.used+1 end,
      day=excluded.day
    where dashboard_ai_quota.day < excluded.day or dashboard_ai_quota.used < 20 returning used`, [actor.profile.id]);
  if (!rows.length) throw new ApiError("RATE_LIMITED", "Лимит AI: 20 запросов в сутки. Он обновится в полночь по Алматы.");
  return 20 - Number(rows[0]!.used);
}
export async function askAssistant(deps: RegistryDeps, actor: Actor, config: AssistantConfig | undefined, input: Record<string, unknown>, answer = deepseekAnswer) {
  if (!allowed(actor, config)) throw new ApiError("FORBIDDEN", "AI-ассистент отключён для этого пользователя");
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 2000) throw new ApiError("VALIDATION_FAILED", "Введите вопрос от 1 до 2 000 символов");
  // Never accept a client-supplied context, role, history or source IDs.
  const dashboard = await getDashboard(deps, actor);
  const summary = dashboard.widgets.map(w => ({ title: w.title, total: w.total }));
  const remaining = await reserveAssistantRequest(deps, actor);
  await deps.audit.append(deps.db, buildAuditInput(actor, { action: "tech.dashboard.ai.request", entityType: "assistant", meta: { model: "deepseek-flash" } }));
  const result = await answer(config.apiKey, input.question.trim(), summary, actor.profile.language);
  return { ...result, remaining, generated_at: dashboard.generated_at,
    sources: dashboard.widgets.map(w => ({ title: w.title, href: w.href, total: w.total })) };
}
