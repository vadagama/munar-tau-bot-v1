import { assistantConfig, type AssistantConfig } from "../../core/src/domains/dashboard/assistant.ts";
import { consumeRateLimit } from "../../core/src/domains/requests/rate-limit.ts";
import { SupabaseFileStorage, type FileStorage } from "../../core/src/domains/requests/files.ts";
import { botScenarios } from "../../core/src/bot/scenarios.ts";
// Зависимости функции api (ADR-003: env передаётся источником значений,
// ядро не знает о рантайме). В тестах подставляются in-memory фейки ядра и
// подставка env; в проде defaultDeps собирает SQL-репозитории над общим
// клиентом postgres.js.

import {
  createDbClient,
  type DbClient,
} from "../../core/src/db/client.ts";
import { optionalEnv, requireEnv, type EnvSource } from "../../core/src/config/env.ts";
import { buildJwtKeys, type JwtVerifyKey } from "../../core/src/auth/jwt.ts";
import type { ScenarioRegistry } from "../../core/src/bot/registry.ts";
import { SqlAdminRepo } from "../../core/src/domains/admin/repo.ts";
import type { AdminRepo } from "../../core/src/domains/admin/port.ts";
import { SqlAuditRepo } from "../../core/src/domains/audit/repo.ts";
import type { AuditRepo } from "../../core/src/domains/audit/port.ts";
import { SqlEmulationRepo } from "../../core/src/domains/emulation/repo.ts";
import type { EmulationRepo } from "../../core/src/domains/emulation/port.ts";

export interface ApiDeps {
  assistant?: AssistantConfig;
  rateLimit?: (profileId:string)=>Promise<void>;
  storage?: FileStorage;
  /** Ключи проверки подписи JWT из JWKS (Supabase Auth; SUPABASE_JWKS инжектируется платформой). */
  jwtKeys: readonly JwtVerifyKey[];
  /** Разрешённый origin кабинета; undefined — разрешён localhost (dev). */
  cabinetOrigin: string | undefined;
  /** Исполнитель и владелец транзакций. */
  db: DbClient;
  admin: AdminRepo;
  audit: AuditRepo;
  emulation: EmulationRepo;
  /** Сценарии симулятора; в VS-1 пуст (сценарии бота — с VS-2). */
  scenarios: ScenarioRegistry;
}

let sharedDb: DbClient | undefined;

/** Клиент БД на время жизни изолята функции (singleton, план VS-1).
 *
 * Пул ограничен на изолят: на стенде Supabase max_connections = 60, а каждый
 * изолят держит собственный пул — без idle_timeout простаивающие соединения
 * копятся по изолятам и исчерпывают слоты (500 при отказе в коннекте,
 * инцидент 2026-10-17). idle_timeout закрывает соединение после 10 с простоя;
 * max: 2 достаточно — конвейер запроса идёт последовательно.
 */
function sharedDbClient(connectionString: string): DbClient {
  if (!sharedDb) {
    // prepare: false задан в createDbClient — пулер транзакций Supabase.
    sharedDb = createDbClient(connectionString, { max: 2, idleTimeout: 10 });
  }
  return sharedDb;
}

/** Зависимости из env. Отсутствие обязательных — ConfigError (500 INTERNAL). */
export async function defaultDeps(env: EnvSource): Promise<ApiDeps> {
  return {
    assistant: assistantConfig(env),
    // SUPABASE_JWKS и SUPABASE_DB_URL инжектируются платформой (документация
    // Supabase, Default secrets); CABINET_ORIGIN — наш секрет функции.
    jwtKeys: await buildJwtKeys(requireEnv(env, "SUPABASE_JWKS")),
    cabinetOrigin: optionalEnv(env, "CABINET_ORIGIN"),
    rateLimit: profileId=>consumeRateLimit(sharedDbClient(requireEnv(env,"SUPABASE_DB_URL")),profileId),
    storage: optionalEnv(env,"SUPABASE_URL") && optionalEnv(env,"SUPABASE_SERVICE_ROLE_KEY") ? new SupabaseFileStorage(requireEnv(env,"SUPABASE_URL"),requireEnv(env,"SUPABASE_SERVICE_ROLE_KEY")) : undefined,
    db: sharedDbClient(requireEnv(env, "SUPABASE_DB_URL")),
    admin: new SqlAdminRepo(),
    audit: new SqlAuditRepo(),
    emulation: new SqlEmulationRepo(),
    scenarios: botScenarios({db:sharedDbClient(requireEnv(env, "SUPABASE_DB_URL")),audit:new SqlAuditRepo()}),
  };
}
