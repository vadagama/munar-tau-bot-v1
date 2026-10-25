import * as dashboard from "./service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { assistantStatus, askAssistant, assistantContext, assistantConfig, reserveAssistantRequest } from "./assistant.ts";
import { deepseekAnswer } from "./assistant-provider.ts";
const actor = { person: { id: "person", status: "active", isTest: false }, profile: { id: "profile", language: "ru" }, assignments: [], emulation: null } as unknown as Actor;
const config = { apiKey: "test-secret", profileIds: ["profile"] };
const deps = () => ({ db: { query: vi.fn().mockResolvedValue([{ used: 1 }]) }, audit: { append: vi.fn() } }) as unknown as RegistryDeps;
afterEach(() => vi.restoreAllMocks());
describe("assistant boundary", () => {
  it("is disabled by default, and for unlisted, archived, test and emulated actors", async () => {
    const d = deps();
    for (const [a, c] of [[actor, undefined], [actor, { ...config, profileIds: [] }], [{ ...actor, person: { ...actor.person, status: "archived" } }, config], [{ ...actor, person: { ...actor.person, isTest: true } }, config], [{ ...actor, emulation: {} }, config]] as const) {
      expect(await assistantStatus(d, a as Actor, c)).toEqual({ state: "disabled" });
      await expect(askAssistant(d, a as Actor, c, { question: "Что делать?" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(d.db.query).not.toHaveBeenCalled();
  });
  it("requires both server key and explicit profile enablement", () => {
    expect(assistantConfig(() => undefined)).toBeUndefined();
    expect(assistantConfig(k => k === "DEEPSEEK_API_KEY" ? "secret" : " profile , other ")).toEqual({ apiKey: "secret", profileIds: ["profile", "other"] });
  });
  it("reserves daily quota atomically and refuses the 21st attempt", async () => {
    const d = deps();
    expect(await reserveAssistantRequest(d, actor)).toBe(19);
    const [sql, params] = vi.mocked(d.db.query).mock.calls[0]!;
    expect(sql).toContain("on conflict"); expect(sql).toContain("used < 20"); expect(sql).toContain("Asia/Almaty"); expect(params).toEqual(["profile"]);
    vi.mocked(d.db.query).mockResolvedValue([]);
    await expect(reserveAssistantRequest(d, actor)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("has no daily quota for tech admin, but does not grant access automatically", async () => {
    const tech = { ...actor, assignments: [{ role: "tech_admin" }] } as Actor;
    const d = deps();
    expect(await reserveAssistantRequest(d, tech)).toBeNull();
    expect(await assistantStatus(d, tech, config)).toEqual({ state: "enabled", remaining: null, daily_limit: null });
    expect(await assistantStatus(d, tech, { ...config, profileIds: [] })).toEqual({ state: "disabled" });
    expect(d.db.query).not.toHaveBeenCalled();
  });
  it("rebuilds and strips context before provider call, reserves first and never audits prompt text", async () => {
    vi.spyOn(dashboard, "getDashboard").mockResolvedValue({ widgets: [{ id: "new", title: "Новые обращения", total: 8, href: "/requests", items: [{ id: "private-id", label: "private-person-text", state: "new", href: "/requests?private-id" }] }], analytics: true, assistant: { state: "disabled" }, generated_at: "now" });
    const d = deps();
    const answer = vi.fn().mockImplementation(async () => {
      expect(d.db.query).toHaveBeenCalledTimes(1);
      expect(d.audit.append).toHaveBeenCalledTimes(1);
      return { text: "Восемь", truncated: false };
    });
    const result = await askAssistant(d, actor, config, { question: "Сводка", summary: [{ title: "injected", total: 999 }], role: "chairman" }, answer);
    expect(answer).toHaveBeenCalledWith("test-secret", "Сводка", [{ title: "Новые обращения", total: 8, ref: "ref:q0", items: [] }], "ru");
    expect(JSON.stringify(vi.mocked(d.audit.append).mock.calls)).not.toMatch(/Сводка|private|test-secret/);
    expect(result.sources).toEqual([{ title: "Новые обращения", href: "/requests", total: 8, ref: "ref:q0" }]);
    vi.mocked(d.db.query).mockResolvedValue([]); answer.mockClear();
    await expect(askAssistant(d, actor, config, { question: "Сводка" }, answer)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(answer).not.toHaveBeenCalled();
  });
  it("rejects excessive or empty questions before quota or network access", async () => {
    const d = deps();
    for (const question of [" ", "x".repeat(2001), 4]) await expect(askAssistant(d, actor, config, { question })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(d.db.query).not.toHaveBeenCalled();
  });
});
describe("DeepSeek transport", () => {
  it("uses the selected model, server credential, bounded answer and only aggregate context", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Очереди пусты." }, finish_reason: "stop" }] })));
    expect(await deepseekAnswer("test-secret", "Что делать?", [{ title: "Задания", total: 0 }], "ru", fetcher)).toEqual({ text: "Очереди пусты.", truncated: false });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(init.body)).toMatchObject({ model: "deepseek-flash", max_tokens: 2000, thinking: { type: "disabled" }, stream: false });
    expect(init.redirect).toBe("error");
  });
  it("does not leak provider errors or return malformed replies", async () => {
    for (const response of [new Response("private-key-error", { status: 401 }), new Response('{}'), new Response('{"choices":[{"message":{"content":""}}]}')]) {
      await expect(deepseekAnswer("secret", "?", [], "ru", vi.fn().mockResolvedValue(response))).rejects.toThrow("AI-ассистент временно недоступен");
    }
  });
});

it("gives the model opaque references and numbers, never entity IDs or descriptions", () => {
  const result = assistantContext([{ id: "new", title: "Новые", total: 1, href: "/requests", items: [{ id: "private-id", label: "№120 · private resident text", state: "new", href: "/requests?request=private-id&entity_page=1" }] }]);
  expect(result.summary[0]!.items[0]).toEqual({ title: "Обращение №120", ref: "ref:e1" });
  expect(JSON.stringify(result.summary)).not.toMatch(/private/);
  expect(result.sources[1]!.href).toContain("request=private-id");
});

it("normalizes subscription contacts and rejects unsafe URLs", async () => {
  const env: Record<string,string> = { DEEPSEEK_API_KEY: "secret", AI_ENABLED_PROFILE_IDS: "profile", AI_SUBSCRIPTION_TELEGRAM: "@support_test", AI_SUBSCRIPTION_PHONE: "+7 (700) 123-45-67" };
  const c = assistantConfig(k => env[k]);
  expect(c?.support).toEqual({ telegram: "https://t.me/support_test", phone: "tel:+77001234567" });
  expect(await assistantStatus(deps(), actor, c)).toMatchObject({ support: c?.support });
  env.AI_SUBSCRIPTION_TELEGRAM = "javascript:alert(1)";
  env.AI_SUBSCRIPTION_PHONE = "https://evil.example";
  expect(assistantConfig(k => env[k])?.support).toBeUndefined();
});
