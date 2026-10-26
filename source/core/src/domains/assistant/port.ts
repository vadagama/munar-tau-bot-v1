// Порт домена assistant (ADR-021, план S0.2): singleton настроек с единым
// токеном провайдера, per-user конфиги (kill switch) и append-only ledger
// расхода. Реализации: SQL — рядом (repo.ts), in-memory — core/src/testing/assistant.ts.

import type { DbExecutor } from "../../db/client.ts";

/** Singleton настроек (assistant_settings). Токен хранится только зашифрованным. */
export interface AssistantSettingsRecord {
  provider: string;
  baseUrl: string;
  modelId: string;
  apiKeyEncrypted: string | null;
  /** Маска `••••1234` для кабинета; значение токена сюда не попадает никогда. */
  apiKeyMask: string | null;
  version: number;
  updatedAt: string;
}

/** Изменяемые поля настроек (version/updated_at ведёт репозиторий). */
export interface AssistantSettingsPatch {
  provider?: string;
  baseUrl?: string;
  modelId?: string;
  apiKeyEncrypted?: string;
  apiKeyMask?: string;
}

/** Per-user конфиг (assistant_user_config). Выключен у всех по умолчанию. */
export interface AssistantUserConfigRecord {
  profileId: string;
  enabled: boolean;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  /** Эпоха DO: растёт при «Очистить»; PUT конфига её не меняет. */
  epoch: number;
  version: number;
  updatedAt: string;
}

/** Ввод per-user конфига без версионирования (версию ведёт репозиторий). */
export interface AssistantUserConfigInput {
  profileId: string;
  enabled: boolean;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
}

/** Строка списка сотрудников для страницы настроек: человек + его конфиг. */
export interface AssistantStaffConfigRow {
  personId: string;
  /** Последний активный профиль; null — действующего профиля нет. */
  profileId: string | null;
  fullName: string;
  roles: string[];
  telegramUsername: string | null;
  /** Поля конфига; enabled=false и лимиты 0 — конфиг ещё не создавался. */
  enabled: boolean;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  /** null — конфига нет: PUT такой строки выполняет insert (expected_version null). */
  version: number | null;
}

/** Расход по границам суток Asia/Almaty (день «05:00 → 05:00» — задача S6). */
export interface AssistantUsageSummary {
  day: string;
  month: string;
  dayTokens: number;
  monthTokens: number;
}

/** Строка ledger (assistant_usage_ledger, append-only). */
export interface AssistantUsageInput {
  profileId: string;
  operationId: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AssistantRepo {
  getSettings(exec: DbExecutor): Promise<AssistantSettingsRecord | null>;
  /**
   * Атомарное обновление singleton: `where id=1 and version=expectedVersion`,
   * version+1. null — версии не совпали или строки нет (singleton сидируется
   * миграцией, поэтому null почти всегда означает конфликт версий).
   */
  updateSettings(
    exec: DbExecutor,
    patch: AssistantSettingsPatch,
    expectedVersion: number,
  ): Promise<AssistantSettingsRecord | null>;
  /** Сотрудники ОСИ с их per-user конфигами (join person/profile/assignment). */
  listStaffConfigs(exec: DbExecutor, isTest: boolean): Promise<AssistantStaffConfigRow[]>;
  getUserConfig(
    exec: DbExecutor,
    profileId: string,
  ): Promise<AssistantUserConfigRecord | null>;
  /**
   * Insert (expectedVersion null) или update по точной версии; version+1.
   * null в ответе — конфликт версий или строка появилась при insert.
   * Эпоху не меняет — её поднимает только clearAssistantSession.
   */
  upsertUserConfig(
    exec: DbExecutor,
    input: AssistantUserConfigInput,
    expectedVersion: number | null,
  ): Promise<AssistantUserConfigRecord | null>;
  /**
   * «Очистить контекст»: epoch = max(epoch, номер UTC-суток) + 1.
   * null — конфига нет (сотрудник не включался). Версию не меняет.
   */
  bumpUserConfigEpoch(exec: DbExecutor, profileId: string): Promise<number | null>;
  /** Append-only запись расхода; false — operation_id уже записан (повтор). */
  insertUsage(exec: DbExecutor, input: AssistantUsageInput): Promise<boolean>;
  /** Суммарный расход за текущие день/месяц по Asia/Almaty. */
  sumUsage(exec: DbExecutor, profileId: string): Promise<AssistantUsageSummary>;
}
