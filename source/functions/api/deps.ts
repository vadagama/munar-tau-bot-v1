// Зависимости функции api (ADR-003: env передаётся источником значений,
// ядро не знает о рантайме). В тестах подставляются in-memory фейки ядра и
// подставка env; в проде defaultDeps собирает SQL-репозитории над общим
// клиентом postgres.js.

import {
  createDbClient,
  type DbClient,
} from "../../core/src/db/client.ts";
import { optionalEnv, requireEnv, type EnvSource } from "../../core/src/config/env.ts";
import { ScenarioRegistry } from "../../core/src/bot/registry.ts";
import { SqlAdminRepo } from "../../core/src/domains/admin/repo.ts";
import type { AdminRepo } from "../../core/src/domains/admin/port.ts";
import { SqlAuditRepo } from "../../core/src/domains/audit/repo.ts";
import type { AuditRepo } from "../../core/src/domains/audit/port.ts";
import { SqlEmulationRepo } from "../../core/src/domains/emulation/repo.ts";
import type { EmulationRepo } from "../../core/src/domains/emulation/port.ts";

export interface ApiDeps {
  /** Секрет проверки подписи JWT (HS256, Supabase Auth). */
  jwtSecret: string;
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

/** Клиент БД на время жизни изолята функции (singleton, план VS-1). */
function sharedDbClient(connectionString: string): DbClient {
  if (!sharedDb) {
    // prepare: false задан в createDbClient — пулер транзакций Supabase.
    sharedDb = createDbClient(connectionString);
  }
  return sharedDb;
}

/** Зависимости из env. Отсутствие обязательных — ConfigError (500 INTERNAL). */
export function defaultDeps(env: EnvSource): ApiDeps {
  return {
    jwtSecret: requireEnv(env, "SUPABASE_JWT_SECRET"),
    cabinetOrigin: optionalEnv(env, "CABINET_ORIGIN"),
    db: sharedDbClient(requireEnv(env, "SUPABASE_DB_URL")),
    admin: new SqlAdminRepo(),
    audit: new SqlAuditRepo(),
    emulation: new SqlEmulationRepo(),
    scenarios: new ScenarioRegistry(),
  };
}
