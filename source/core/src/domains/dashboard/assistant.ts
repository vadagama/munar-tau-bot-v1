import type { EnvSource } from "../../config/env.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { buildAuditInput } from "../audit/entry.ts";
import { getDashboard, type DashboardWidget } from "./service.ts";
import { deepseekAnswer } from "./assistant-provider.ts";
export interface AssistantSupport { telegram?: string; phone?: string }
export interface AssistantConfig { apiKey: string; profileIds: readonly string[]; support?: AssistantSupport }
export type AssistantStatus = { state: "disabled" } | { state: "unavailable" } | { state: "enabled" | "limit"; remaining: number | null; daily_limit: number | null; support?: AssistantSupport };
export function assistantConfig(env: EnvSource): AssistantConfig | undefined {
  const apiKey = env("DEEPSEEK_API_KEY")?.trim();
  const profileIds = (env("AI_ENABLED_PROFILE_IDS") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const telegramName = env("AI_SUBSCRIPTION_TELEGRAM")?.trim().replace(/^https:\/\/t\.me\//, "").replace(/^@/, "");
  const phoneNumber = env("AI_SUBSCRIPTION_PHONE")?.trim().replace(/[ ()-]/g, "");
  const telegram = telegramName && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(telegramName) ? `https://t.me/${telegramName}` : undefined;
  const phone = phoneNumber && /^\+[1-9]\d{6,14}$/.test(phoneNumber) ? `tel:${phoneNumber}` : undefined;
  const contact = telegram || phone ? { support: { telegram, phone } } : {};
  return apiKey && profileIds.length ? { apiKey, profileIds, ...contact } : undefined;
}
function allowed(actor: Actor, config?: AssistantConfig): config is AssistantConfig {
  return !!config?.apiKey && config.profileIds.includes(actor.profile.id) && actor.person.status === "active" && !actor.person.isTest && !actor.emulation;
}
const unlimited = (actor: Actor) => actor.assignments.some(a => a.role === "tech_admin");
export async function assistantStatus(deps: RegistryDeps, actor: Actor, config?: AssistantConfig): Promise<AssistantStatus> {
  if (!allowed(actor, config)) return { state: "disabled" };
  if (unlimited(actor)) return { state: "enabled", remaining: null, daily_limit: null, ...(config.support ? { support: config.support } : {}) };
  try {
    const rows = await deps.db.query<{ used: number }>(`select used from dashboard_ai_quota where profile_id=$1 and day=(now() at time zone 'Asia/Almaty')::date`, [actor.profile.id]);
    const remaining = Math.max(0, 20 - Number(rows[0]?.used ?? 0));
    return { state: remaining ? "enabled" : "limit", remaining, daily_limit: 20, ...(config.support ? { support: config.support } : {}) };
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
/** Opaque navigation refs carry no database IDs or resident-authored text to the provider. */
export function assistantContext(widgets: DashboardWidget[]) {
  const sources: Array<{ ref: string; title: string; href: string; total?: number }> = [];
  const entityNames: Record<string,string> = { new: "Обращение", action: "Обращение", tasks: "Задание", incidents: "Авария" };
  const summary = widgets.map((w, i) => {
    const ref = `ref:q${i}`;
    sources.push({ ref, title: w.title, href: w.href, total: w.total });
    const items = w.items.flatMap(item => {
      const number = /^№(\d+)\b/.exec(item.label)?.[1];
      if (!number || !entityNames[w.id]) return [];
      let source = sources.find(s => s.href === item.href);
      if (!source) { source = { ref: `ref:e${sources.length}`, title: `${entityNames[w.id]} №${number}`, href: item.href }; sources.push(source); }
      return [{ title: source.title, ref: source.ref }];
    });
    return { title: w.title, total: w.total, ref, items };
  });
  return { sources, summary };
}
export async function askAssistant(deps: RegistryDeps, actor: Actor, config: AssistantConfig | undefined, input: Record<string, unknown>, answer = deepseekAnswer) {
  if (!allowed(actor, config)) throw new ApiError("FORBIDDEN", "AI-ассистент отключён для этого пользователя");
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 2000) throw new ApiError("VALIDATION_FAILED", "Введите вопрос от 1 до 2 000 символов");
  // Never accept a client-supplied context, role, history or source IDs.
  const dashboard = await getDashboard(deps, actor);
  const { summary, sources } = assistantContext(dashboard.widgets);
  const remaining = await reserveAssistantRequest(deps, actor);
  await deps.audit.append(deps.db, buildAuditInput(actor, { action: "tech.dashboard.ai.request", entityType: "assistant", meta: { model: "deepseek-flash" } }));
  const result = await answer(config.apiKey, input.question.trim(), summary, actor.profile.language);
  return { ...result, remaining, generated_at: dashboard.generated_at,
    sources };
}
