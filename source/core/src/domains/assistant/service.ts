// Сервис домена assistant (ADR-021, план S0.2/S0.3): настройки с единым
// токеном провайдера, per-user конфиги (kill switch), выдача runtime-token и
// сервисный учёт расхода. Токен провайдера никогда не возвращается в кабинет
// и не попадает в аудит — только маска; расшифрованное значение отдаёт
// исключительно issueRuntimeToken держателю валидного JWT с assistant.use.

import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { AdminRepo } from "../admin/port.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { content, idempotent } from "../requests/service.ts";
import { invalid } from "../registry/validation.ts";
import {
  decodeKeySecret,
  decryptApiKey,
  encryptApiKey,
  maskApiKey,
} from "./crypto.ts";
import type {
  AssistantRepo,
  AssistantSettingsPatch,
  AssistantStaffConfigRow,
  AssistantUserConfigInput,
} from "./port.ts";

export interface AssistantDeps extends RegistryDeps {
  admin: AdminRepo;
  assistant: AssistantRepo;
  /** Base64-ключ AES-256-GCM (секрет функций ASSISTANT_API_KEY_SECRET). */
  keySecret?: string;
}

const TOKEN_LIMIT_MAX = 10_000_000;
const MAX_USERS_PER_SAVE = 1000;

/** Строка пер-user конфига из PUT /v1/assistant/settings. */
interface UserConfigChange {
  profileId: string;
  enabled: boolean;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  /** null — конфига ещё нет, ожидается insert. */
  expectedVersion: number | null;
}

function requirePermission(actor: Actor, action: Parameters<typeof can>[1], resource?: ResourceRef): void {
  if (actor.person.status !== "active" || !can(actor, action, resource).allow) {
    throw new ApiError("FORBIDDEN");
  }
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    invalid(`Заполните ${label} (до ${max} символов)`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, label, max);
}

function tokenLimit(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > TOKEN_LIMIT_MAX) {
    invalid(`${label}: целое число от 0 до ${TOKEN_LIMIT_MAX}`);
  }
  return value;
}

function parseUserChanges(value: unknown): UserConfigChange[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_USERS_PER_SAVE) {
    invalid(`Список сотрудников: до ${MAX_USERS_PER_SAVE} строк`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") invalid("Строка сотрудника — объект");
    const row = item as Record<string, unknown>;
    const enabled = row.enabled;
    if (typeof enabled !== "boolean") invalid("Поле enabled — boolean");
    const daily = tokenLimit(row.daily_token_limit, "Дневной лимит токенов");
    const monthly = tokenLimit(row.monthly_token_limit, "Месячный лимит токенов");
    if (enabled && (daily <= 0 || monthly <= 0)) {
      invalid("Для включённого сотрудника задайте дневной и месячный лимиты больше нуля");
    }
    const expected = row.expected_version;
    if (expected !== null && typeof expected !== "number") {
      invalid("Нужна версия конфига сотрудника (или null для нового)");
    }
    return {
      profileId: text(row.profile_id, "профиль сотрудника", 64),
      enabled,
      dailyTokenLimit: daily,
      monthlyTokenLimit: monthly,
      expectedVersion: expected === null ? null : expected,
    } satisfies UserConfigChange;
  });
}

/** Вид настроек для кабинета: маска вместо токена, без api_key_encrypted. */
function maskedView(settings: {
  provider: string;
  baseUrl: string;
  modelId: string;
  apiKeyMask: string | null;
  version: number;
}): {
  provider: string;
  base_url: string;
  model_id: string;
  api_key_mask: string | null;
  version: number;
} {
  return {
    provider: settings.provider,
    base_url: settings.baseUrl,
    model_id: settings.modelId,
    api_key_mask: settings.apiKeyMask,
    version: settings.version,
  };
}

function userView(row: AssistantStaffConfigRow) {
  return {
    person_id: row.personId,
    profile_id: row.profileId,
    full_name: row.fullName,
    roles: row.roles,
    telegram_username: row.telegramUsername,
    enabled: row.enabled,
    daily_token_limit: row.dailyTokenLimit,
    monthly_token_limit: row.monthlyTokenLimit,
    version: row.version,
  };
}

/**
 * Данные страницы «Настройки AI-ассистента» (S0.4): singleton маской +
 * сотрудники с per-user конфигами. Список сотрудников — собственный SQL
 * репозитория, не staff.read: техадмин сознательно не имеет полномочий на
 * журнал персонала (проверено в S0.3), но страницу настроек ведёт.
 */
export async function assistantSettingsView(deps: AssistantDeps, actor: Actor) {
  requirePermission(actor, "assistant.settings.read");
  const settings = await deps.assistant.getSettings(deps.db);
  const users = await deps.assistant.listStaffConfigs(deps.db, actor.person.isTest);
  return {
    settings: settings ? maskedView(settings) : null,
    users: users.map(userView),
  };
}

/**
 * PUT /v1/assistant/settings (S0.3): обновление singleton (провайдер, модель,
 * замена токена — write-only) и/или per-user конфигов в одной транзакции.
 * Причина и Idempotency-Key обязательны; 409 — по expected_version.
 */
export async function saveAssistantSettings(
  deps: AssistantDeps,
  actor: Actor,
  input: Record<string, unknown>,
  key: unknown,
) {
  requirePermission(actor, "assistant.settings.edit");
  const reason = content(input.reason, "причину изменения настроек ассистента");

  const patch: AssistantSettingsPatch = {};
  const provider = optionalText(input.provider, "провайдера", 100);
  const baseUrl = optionalText(input.base_url, "адрес API", 500);
  const modelId = optionalText(input.model_id, "идентификатор модели", 200);
  const apiKey = optionalText(input.api_key, "токен провайдера", 1000);
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) invalid("Адрес API начинается с http(s)://");
  if (provider !== undefined) patch.provider = provider;
  if (baseUrl !== undefined) patch.baseUrl = baseUrl;
  if (modelId !== undefined) patch.modelId = modelId;
  const hasSettingsFields = Object.keys(patch).length > 0 || apiKey !== undefined;
  const expectedVersion = input.expected_version;
  if (
    hasSettingsFields &&
    (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion))
  ) {
    invalid("Нужна версия настроек (expected_version)");
  }
  const users = parseUserChanges(input.users);
  if (!hasSettingsFields && users.length === 0) {
    invalid("Укажите изменения настроек или конфигов сотрудников");
  }

  return deps.db.transaction(async (exec) => {
    const profile = await deps.admin.getProfile(exec, actor.profile.id);
    if (!profile || profile.archivedAt) throw new ApiError("FORBIDDEN");
    const fresh = await buildActorForProfile(deps.admin, exec, profile, new Date());
    if (!can(fresh, "assistant.settings.edit").allow) throw new ApiError("FORBIDDEN");
    return idempotent(exec, fresh, "assistant:settings", key, input, async () => {
      let settings = await deps.assistant.getSettings(exec);
      if (hasSettingsFields) {
        if (!settings) throw new ApiError("NOT_FOUND");
        if (apiKey) {
          if (!deps.keySecret) {
            throw new ApiError(
              "INTERNAL",
              "ASSISTANT_API_KEY_SECRET не настроен — шифрование токена недоступно",
            );
          }
          patch.apiKeyEncrypted = await encryptApiKey(
            apiKey,
            decodeKeySecret(deps.keySecret),
          );
          patch.apiKeyMask = maskApiKey(apiKey);
        }
        const before = maskedView(settings);
        const updated = await deps.assistant.updateSettings(exec, patch, expectedVersion as number);
        if (!updated) throw new ApiError("CONCURRENT_MODIFICATION");
        settings = updated;
        // Токен в аудит не попадает: только маска и состав изменённых полей.
        await recordAudit(
          deps,
          exec,
          fresh,
          "assistant.settings.changed",
          "assistant_settings",
          "1",
          [],
          before,
          maskedView(settings),
          reason,
        );
      }
      for (const change of users) {
        const target = await deps.admin.getProfile(exec, change.profileId);
        if (!target || target.archivedAt || target.isTest !== fresh.person.isTest) {
          invalid("Выберите зарегистрированного пользователя с действующим профилем");
        }
        const current = await deps.assistant.getUserConfig(exec, change.profileId);
        if (current ? current.version !== change.expectedVersion : change.expectedVersion !== null) {
          throw new ApiError("CONCURRENT_MODIFICATION");
        }
        const saved = await deps.assistant.upsertUserConfig(
          exec,
          {
            profileId: change.profileId,
            enabled: change.enabled,
            dailyTokenLimit: change.dailyTokenLimit,
            monthlyTokenLimit: change.monthlyTokenLimit,
          } satisfies AssistantUserConfigInput,
          change.expectedVersion,
        );
        if (!saved) throw new ApiError("CONCURRENT_MODIFICATION");
        await recordAudit(
          deps,
          exec,
          fresh,
          "assistant.user_config.changed",
          "assistant_user_config",
          change.profileId,
          [],
          current
            ? {
                enabled: current.enabled,
                daily_token_limit: current.dailyTokenLimit,
                monthly_token_limit: current.monthlyTokenLimit,
              }
            : null,
          {
            enabled: change.enabled,
            daily_token_limit: change.dailyTokenLimit,
            monthly_token_limit: change.monthlyTokenLimit,
          },
          reason,
        );
      }
      const view = settings ? maskedView(settings) : null;
      return {
        settings: view,
        users_saved: users.length,
      };
    });
  });
}

/** Доступ и остаток одного профиля — контракт settings/me и usage. */
export interface AssistantAccessView {
  enabled: boolean;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  day_used: number;
  month_used: number;
  day: string;
  month: string;
}

/** Доступ и остаток одного профиля — общая часть settings/me и usage. */
async function accessView(
  deps: AssistantDeps,
  exec: DbExecutor,
  profileId: string,
): Promise<AssistantAccessView> {
  const config = await deps.assistant.getUserConfig(exec, profileId);
  const summary = await deps.assistant.sumUsage(exec, profileId);
  return {
    enabled: config?.enabled ?? false,
    daily_token_limit: config?.dailyTokenLimit ?? null,
    monthly_token_limit: config?.monthlyTokenLimit ?? null,
    day_used: summary.dayTokens,
    month_used: summary.monthTokens,
    day: summary.day,
    month: summary.month,
  };
}

/**
 * GET /v1/assistant/settings/me: свой доступ и остаток лимитов. Выключенному
 * сотруднику возвращает enabled=false — кабинет не открывает чат.
 */
export async function myAssistantAccess(deps: AssistantDeps, actor: Actor) {
  requirePermission(actor, "assistant.usage.read", { profileId: actor.profile.id });
  return accessView(deps, deps.db, actor.profile.id);
}

/**
 * GET /v1/assistant/usage?profile_id=: свой расход (allowOwn) или чужой —
 * председатель/техадмин.
 */
export async function assistantUsage(
  deps: AssistantDeps,
  actor: Actor,
  profileId: string | undefined,
) {
  const target = profileId ?? actor.profile.id;
  if (!can(actor, "assistant.usage.read", { profileId: target }).allow) {
    throw new ApiError("FORBIDDEN");
  }
  return { profile_id: target, ...(await accessView(deps, deps.db, target)) };
}

/**
 * POST /v1/assistant/runtime-token: расшифрованный токен провайдера — только
 * действующему профилю с assistant.use и включённым конфигом; выдача
 * журналируется. Выключение сотрудника закрывает доступ на следующем запросе.
 */
export async function issueRuntimeToken(deps: AssistantDeps, actor: Actor) {
  requirePermission(actor, "assistant.use");
  return deps.db.transaction(async (exec) => {
    const profile = await deps.admin.getProfile(exec, actor.profile.id);
    if (!profile || profile.archivedAt) throw new ApiError("FORBIDDEN");
    const fresh = await buildActorForProfile(deps.admin, exec, profile, new Date());
    if (!can(fresh, "assistant.use").allow) throw new ApiError("FORBIDDEN");
    const config = await deps.assistant.getUserConfig(exec, fresh.profile.id);
    if (!config?.enabled) {
      throw new ApiError("FORBIDDEN", "Ассистент не включён для этого профиля");
    }
    const settings = await deps.assistant.getSettings(exec);
    if (!settings?.apiKeyEncrypted) {
      throw new ApiError("VALIDATION_FAILED", "Токен провайдера не задан");
    }
    if (!deps.keySecret) {
      throw new ApiError(
        "INTERNAL",
        "ASSISTANT_API_KEY_SECRET не настроен — расшифровка токена недоступна",
      );
    }
    const apiKey = await decryptApiKey(
      settings.apiKeyEncrypted,
      decodeKeySecret(deps.keySecret),
    );
    await recordAudit(
      deps,
      exec,
      fresh,
      "assistant.runtime_token.issued",
      "profile",
      fresh.profile.id,
      [],
      null,
      { provider: settings.provider, model_id: settings.modelId },
    );
    return {
      provider: settings.provider,
      base_url: settings.baseUrl,
      model_id: settings.modelId,
      api_key: apiKey,
    };
  });
}

/**
 * POST /v1/assistant/usage — сервисный учёт расхода от Worker (секрет
 * X_ASSISTANT_SECRET, вне JWT-конвейера). Идемпотентность — уникальный
 * operation_id в ledger; повтор не удваивает расход. В ledger уже есть все
 * поля учётной записи, повторных записей в audit_log не создаёт.
 */
export async function recordAssistantUsage(
  deps: AssistantDeps,
  input: Record<string, unknown>,
) {
  const profileId = text(input.profile_id, "профиль сотрудника", 64);
  const operationId = text(input.operation_id, "идентификатор операции", 200);
  const promptTokens = tokenLimit(input.prompt_tokens, "prompt_tokens");
  const completionTokens = tokenLimit(input.completion_tokens, "completion_tokens");
  const profile = await deps.admin.getProfile(deps.db, profileId);
  if (!profile || profile.archivedAt) throw new ApiError("NOT_FOUND");
  const accepted = await deps.assistant.insertUsage(deps.db, {
    profileId,
    operationId,
    promptTokens,
    completionTokens,
  });
  const summary = await deps.assistant.sumUsage(deps.db, profileId);
  return {
    accepted,
    day_tokens: summary.dayTokens,
    month_tokens: summary.monthTokens,
    day: summary.day,
    month: summary.month,
  };
}
