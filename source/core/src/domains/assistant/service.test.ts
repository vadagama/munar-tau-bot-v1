// Проверки сервиса assistant на фейках: privileged-запись с идемпотентностью
// и аудитом (образец admin/staff.test.ts), шифрование токена, kill switch,
// append-only ledger с идемпотентностью по operation_id.

import { describe, expect, it } from "vitest";
import { MemoryAssistantRepo } from "../../testing/assistant.ts";
import { MemoryAdminRepo, MemoryAuditRepo, MemoryDb } from "../../testing/memory.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
import type { ProfileRecord } from "../admin/port.ts";
import {
  assistantUsage,
  assistantUsageHistory,
  clearAssistantSession,
  issueRuntimeToken,
  myAssistantAccess,
  recordAssistantUsage,
  saveAssistantSettings,
  type AssistantDeps,
} from "./service.ts";
import { decodeKeySecret, decryptApiKey, generateKeySecret } from "./crypto.ts";
import { makeTestActor } from "../../testing/actors.ts";
import type { Actor, StaffRole } from "../../pdp/types.ts";

class AssistantTestDb extends MemoryDb {
  keys = new Map<string, { request_hash: string; response: unknown }>();
  override async query<T>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    if (sql.startsWith("insert into outbox(")) return super.query(sql, params);
    if (sql.startsWith("select request_hash,response")) {
      return (this.keys.has(String(params[0]))
        ? [this.keys.get(String(params[0]))]
        : []) as T[];
    }
    if (sql.startsWith("insert into idempotency_key")) {
      this.keys.set(String(params[0]), {
        request_hash: String(params[2]),
        response: params[3],
      });
    }
    return [];
  }
}

const KEY_SECRET = generateKeySecret();
const NOW = new Date("2026-10-25T12:00:00Z");

function seedPerson(admin: MemoryAdminRepo, profile: ProfileRecord, fullName: string): void {
  admin.persons.set(profile.personId, {
    id: profile.personId,
    fullName,
    phoneE164: "+70000000001",
    status: "active",
    isTest: true,
    comment: null,
  });
}

async function actorWithRole(
  deps: AssistantDeps,
  profile: ProfileRecord,
  role: StaffRole,
): Promise<Actor> {
  await deps.admin.insertAssignment(deps.db, {
    personId: profile.personId,
    role,
    financialRights: false,
    registryExportRights: false,
    regulationsRights: false,
    scopeBuildingIds: [],
    validFrom: null,
    validUntil: null,
    assignedByPersonId: profile.personId,
  });
  return buildActorForProfile(deps.admin, deps.db, profile, NOW);
}

async function setup() {
  const admin = new MemoryAdminRepo();
  const db = new AssistantTestDb();
  const audit = new MemoryAuditRepo();
  const assistant = new MemoryAssistantRepo();
  const deps: AssistantDeps = { db, audit, admin, assistant, keySecret: KEY_SECRET };
  const chairProfile: ProfileRecord = {
    id: "profile-chair",
    personId: "person-chair",
    telegramUserId: "-1",
    supabaseUserId: null,
    language: "ru",
    isTest: true,
    archivedAt: null,
  };
  const staffProfile: ProfileRecord = {
    id: "profile-staff",
    personId: "person-staff",
    telegramUserId: "-2",
    supabaseUserId: null,
    language: "ru",
    isTest: true,
    archivedAt: null,
  };
  admin.profiles.set(chairProfile.id, chairProfile);
  admin.profiles.set(staffProfile.id, staffProfile);
  seedPerson(admin, chairProfile, "Председатель");
  seedPerson(admin, staffProfile, "Сотрудник");
  return { deps, db, audit, assistant, chairProfile, staffProfile };
}

/** Председатель задал токен и включил самого себя. */
async function enabledChair() {
  const ctx = await setup();
  const chair = await actorWithRole(ctx.deps, ctx.chairProfile, "chairman");
  await saveAssistantSettings(
    ctx.deps,
    chair,
    { api_key: "sk-live-token-7777", expected_version: 1, reason: "первичный токен" },
    "tok-1",
  );
  await saveAssistantSettings(
    ctx.deps,
    chair,
    {
      users: [{
        profile_id: ctx.chairProfile.id,
        enabled: true,
        daily_token_limit: 1000,
        monthly_token_limit: 10000,
        expected_version: null,
      }],
      reason: "себе",
    },
    "self-1",
  );
  return { ...ctx, chair };
}

describe("сервис assistant: настройки", () => {
  it("председатель меняет модель и токен: шифрование, маска, аудит, версия", async () => {
    const { deps, audit, assistant, chairProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    const result = await saveAssistantSettings(
      deps,
      chair,
      {
        model_id: "deepseek-reasoner",
        api_key: "sk-provider-token-9876",
        expected_version: 1,
        reason: "смена модели пилота",
      },
      "key-1",
    );
    expect(result.settings).toEqual({
      provider: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      model_id: "deepseek-reasoner",
      api_key_mask: "••••9876",
      version: 2,
    });
    const stored = assistant.settings!.apiKeyEncrypted!;
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored.includes("sk-provider-token-9876")).toBe(false);
    expect(await decryptApiKey(stored, decodeKeySecret(KEY_SECRET))).toBe(
      "sk-provider-token-9876",
    );
    const entry = audit.entries.find((e) => e.action === "assistant.settings.changed");
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain("sk-provider-token-9876");
  });

  it("повтор с тем же Idempotency-Key возвращает тот же ответ", async () => {
    const { deps, assistant, chairProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    const input = { model_id: "m2", expected_version: 1, reason: "r" };
    const first = await saveAssistantSettings(deps, chair, input, "same-key");
    const second = await saveAssistantSettings(deps, chair, input, "same-key");
    expect(second).toEqual(first);
    expect(assistant.settings!.version).toBe(2);
  });

  it("чужой expected_version — CONCURRENT_MODIFICATION", async () => {
    const { deps, chairProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    await expect(
      saveAssistantSettings(
        deps,
        chair,
        { model_id: "m", expected_version: 7, reason: "r" },
        "k",
      ),
    ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
  });

  it("без причины или без Idempotency-Key — VALIDATION_FAILED", async () => {
    const { deps, chairProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    await expect(
      saveAssistantSettings(deps, chair, { model_id: "m", expected_version: 1 }, "k"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      saveAssistantSettings(
        deps,
        chair,
        { model_id: "m", expected_version: 1, reason: "r" },
        "  ",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("администратору править настройки нельзя", async () => {
    const { deps } = await setup();
    const admin = makeTestActor("administrator", []);
    await expect(
      saveAssistantSettings(
        deps,
        admin,
        { model_id: "m", expected_version: 1, reason: "r" },
        "k",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("сервис assistant: per-user конфиги", () => {
  it("включение сотрудника с лимитами: конфиг создан, аудит записан", async () => {
    const { deps, audit, assistant, chairProfile, staffProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    const result = await saveAssistantSettings(
      deps,
      chair,
      {
        users: [{
          profile_id: staffProfile.id,
          enabled: true,
          daily_token_limit: 100000,
          monthly_token_limit: 1000000,
          expected_version: null,
        }],
        reason: "включение пилота",
      },
      "u-1",
    );
    expect(result.users_saved).toBe(1);
    const config = assistant.configs.get(staffProfile.id);
    expect(config).toMatchObject({
      enabled: true,
      dailyTokenLimit: 100000,
      version: 1,
    });
    expect(
      audit.entries.some(
        (e) =>
          e.action === "assistant.user_config.changed" && e.entityId === staffProfile.id,
      ),
    ).toBe(true);
  });

  it("enabled без лимитов — VALIDATION_FAILED", async () => {
    const { deps, chairProfile, staffProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    await expect(
      saveAssistantSettings(
        deps,
        chair,
        {
          users: [{
            profile_id: staffProfile.id,
            enabled: true,
            daily_token_limit: 0,
            monthly_token_limit: 0,
            expected_version: null,
          }],
          reason: "r",
        },
        "k",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("конфликт версии строки конфига — CONCURRENT_MODIFICATION", async () => {
    const { deps, assistant, chairProfile, staffProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    assistant.configs.set(staffProfile.id, {
      profileId: staffProfile.id,
      enabled: false,
      dailyTokenLimit: 0,
      monthlyTokenLimit: 0,
      epoch: 1,
      version: 3,
      updatedAt: new Date().toISOString(),
    });
    await expect(
      saveAssistantSettings(
        deps,
        chair,
        {
          users: [{
            profile_id: staffProfile.id,
            enabled: true,
            daily_token_limit: 10,
            monthly_token_limit: 100,
            expected_version: 2,
          }],
          reason: "r",
        },
        "k",
      ),
    ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
  });

  it("неизвестный профиль сотрудника — VALIDATION_FAILED", async () => {
    const { deps, chairProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    await expect(
      saveAssistantSettings(
        deps,
        chair,
        {
          users: [{
            profile_id: "profile-ghost",
            enabled: true,
            daily_token_limit: 10,
            monthly_token_limit: 100,
            expected_version: null,
          }],
          reason: "r",
        },
        "k",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("сервис assistant: runtime-token и расход", () => {
  it("включённому выдаётся расшифрованный токен и пишется аудит", async () => {
    const { deps, audit, chair } = await enabledChair();
    const token = await issueRuntimeToken(deps, chair);
    expect(token).toMatchObject({
      provider: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      api_key: "sk-live-token-7777",
    });
    expect(
      audit.entries.some((e) => e.action === "assistant.runtime_token.issued"),
    ).toBe(true);
  });

  it("выключенному с правой use — FORBIDDEN (kill switch)", async () => {
    const { deps, staffProfile } = await enabledChair();
    const staff = await actorWithRole(deps, staffProfile, "administrator");
    await expect(issueRuntimeToken(deps, staff)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("без токена провайдера — VALIDATION_FAILED", async () => {
    const { deps, chairProfile } = await setup();
    const chair = await actorWithRole(deps, chairProfile, "chairman");
    await saveAssistantSettings(
      deps,
      chair,
      {
        users: [{
          profile_id: chairProfile.id,
          enabled: true,
          daily_token_limit: 100,
          monthly_token_limit: 1000,
          expected_version: null,
        }],
        reason: "включение без токена",
      },
      "no-token-1",
    );
    await expect(issueRuntimeToken(deps, chair)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("учёт расхода: повтор operation_id не удваивает", async () => {
    const { deps } = await setup();
    const first = await recordAssistantUsage(deps, {
      profile_id: "profile-staff",
      operation_id: "op-1",
      prompt_tokens: 100,
      completion_tokens: 50,
    });
    expect(first.accepted).toBe(true);
    const repeat = await recordAssistantUsage(deps, {
      profile_id: "profile-staff",
      operation_id: "op-1",
      prompt_tokens: 100,
      completion_tokens: 50,
    });
    expect(repeat.accepted).toBe(false);
    expect(repeat.day_tokens).toBe(150);
    const other = await recordAssistantUsage(deps, {
      profile_id: "profile-staff",
      operation_id: "op-2",
      prompt_tokens: 10,
      completion_tokens: 5,
    });
    expect(other.day_tokens).toBe(165);
  });

  it("учёт расхода: неизвестный профиль — NOT_FOUND", async () => {
    const { deps } = await setup();
    await expect(
      recordAssistantUsage(deps, {
        profile_id: "profile-ghost",
        operation_id: "op-x",
        prompt_tokens: 1,
        completion_tokens: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("settings/me: включённому — enabled и расход по границам Алматы", async () => {
    const { deps, chair } = await enabledChair();
    await recordAssistantUsage(deps, {
      profile_id: "profile-chair",
      operation_id: "op-me-1",
      prompt_tokens: 200,
      completion_tokens: 100,
    });
    const view = await myAssistantAccess(deps, chair);
    expect(view).toMatchObject({
      enabled: true,
      daily_token_limit: 1000,
      monthly_token_limit: 10000,
      day_used: 300,
      month_used: 300,
      profile_id: "profile-chair",
      epoch: 1,
    });
    expect(view.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("usage другого профиля: техадмину доступен, администратору — FORBIDDEN", async () => {
    const { deps } = await setup();
    const tech = makeTestActor("tech_admin", []);
    const admin = makeTestActor("administrator", []);
    const view = await assistantUsage(deps, tech, "profile-staff");
    expect(view.profile_id).toBe("profile-staff");
    await expect(assistantUsage(deps, admin, "profile-staff")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("история расхода: по дням и месяцам, свежие первыми; чужой — только техадмину", async () => {
    const { deps } = await setup();
    await recordAssistantUsage(deps, {
      profile_id: "profile-staff",
      operation_id: "h-1",
      prompt_tokens: 100,
      completion_tokens: 50,
    });
    await recordAssistantUsage(deps, {
      profile_id: "profile-staff",
      operation_id: "h-2",
      prompt_tokens: 20,
      completion_tokens: 30,
    });
    // Своему — свой расход (дефолт profile_id = актор).
    const staff = makeTestActor("administrator", []);
    (staff as { profile: { id: string } }).profile.id = "profile-staff";
    const own = await assistantUsageHistory(deps, staff, undefined, "day");
    expect(own.granularity).toBe("day");
    expect(own.rows).toHaveLength(1);
    const dayRow = own.rows[0]!;
    expect(dayRow).toMatchObject({ prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 });
    expect(dayRow.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Чужой расход (history) администратору не виден — то же право, что у usage.
    await expect(assistantUsageHistory(deps, staff, "profile-chair", "day")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const tech = makeTestActor("tech_admin", []);
    const byMonth = await assistantUsageHistory(deps, tech, "profile-staff", "month");
    expect(byMonth.granularity).toBe("month");
    const monthRow = byMonth.rows[0]!;
    expect(monthRow.period).toMatch(/^\d{4}-\d{2}$/);
    expect(monthRow.total_tokens).toBe(200);
    // Неизвестный разрез — день (дефолт), лимит окна — 14 дней.
    const byDay = await assistantUsageHistory(deps, tech, "profile-staff", "week");
    expect(byDay.granularity).toBe("day");
  });
});

describe("сервис assistant: очистка сеанса (эпохи DO)", () => {
  it("очистка поднимает эпоху выше сегодняшнего UTC-дня и пишет аудит", async () => {
    const { deps, audit, chair, assistant } = await enabledChair();
    const before = (await assistant.getUserConfig(deps.db, "profile-chair"))?.epoch ?? null;
    const result = await clearAssistantSession(deps, chair, "clear-1");
    const utcDay = Math.floor(new Date().getTime() / 86_400_000);
    expect(result.epoch).toBe(Math.max(before ?? 1, utcDay) + 1);
    expect(result.epoch).toBeGreaterThan(utcDay);
    expect(
      audit.entries.some((e) =>
        e.action === "assistant.session.cleared" &&
        (e.after as { epoch?: number } | null)?.epoch === result.epoch,
      ),
    ).toBe(true);
  });

  it("повтор очистки с тем же Idempotency-Key возвращает ту же эпоху", async () => {
    const { deps, chair } = await enabledChair();
    const first = await clearAssistantSession(deps, chair, "clear-key");
    const second = await clearAssistantSession(deps, chair, "clear-key");
    expect(second.epoch).toBe(first.epoch);
  });

  it("повторная очистка продолжает рост эпохи", async () => {
    const { deps, chair } = await enabledChair();
    const first = await clearAssistantSession(deps, chair, "clear-1");
    const second = await clearAssistantSession(deps, chair, "clear-2");
    expect(second.epoch).toBe(first.epoch + 1);
  });

  it("выключенному сотруднику очистка недоступна (PDP)", async () => {
    const { deps, staffProfile } = await setup();
    const staff = await actorWithRole(deps, staffProfile, "administrator");
    await expect(clearAssistantSession(deps, staff, "clear-staff")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("очистка не меняет version конфига и расход не обнуляется", async () => {
    const { deps, chair, assistant } = await enabledChair();
    await recordAssistantUsage(deps, {
      profile_id: "profile-chair",
      operation_id: "op-clear-1",
      prompt_tokens: 100,
      completion_tokens: 50,
    });
    const configBefore = await assistant.getUserConfig(deps.db, "profile-chair");
    await clearAssistantSession(deps, chair, "clear-1");
    const configAfter = await assistant.getUserConfig(deps.db, "profile-chair");
    expect(configAfter?.version).toBe(configBefore?.version);
    const view = await myAssistantAccess(deps, chair);
    expect(view.month_used).toBe(150);
    expect(view.epoch).toBeGreaterThan(configBefore?.epoch ?? 0);
  });
});
