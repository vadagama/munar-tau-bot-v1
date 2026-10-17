// Инфраструктура интеграционных тестов: подключение к БД dev-проекта Supabase,
// применение миграций (идемпотентно), очистка данных между тестами.
//
// Включается переменной TEST_DATABASE_URL (шаблон — tools/scripts/env.example.txt):
// без неё интеграционные тесты пропускаются, модульные от БД не зависят.
// БД используется общая и очищается truncate'ом — только dev-проект
// с вымышленными данными (HLD §20), не пилот и не рабочая среда.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import dns from "node:dns";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDbClient, type DbClient, type DbExecutor } from "../../src/db/client.ts";

// ELB session pooler Supabase имеет AAAA-запись: в сети без IPv6 Node зависает
// на v6-попытке (write CONNECT_TIMEOUT) — IPv4 всегда приоритетнее.
dns.setDefaultResultOrder("ipv4first");

const helperDir = dirname(fileURLToPath(import.meta.url));
// .../core/tests/integration → .../source
const sourceDir = resolve(helperDir, "../../..");
const migrationsDir = resolve(sourceDir, "db/migrations");
const seedPath = resolve(sourceDir, "db/seed/identity_dev.sql");

/** Фиксированные идентификаторы сида identity_dev.sql (VS-1). */
export const SEED = {
  building1: "11111111-1111-1111-1111-111111111101",
  building2: "11111111-1111-1111-1111-111111111102",
  building3: "11111111-1111-1111-1111-111111111103",
  chairmanPersonId: "22222222-2222-2222-2222-222222222201",
  techAdminPersonId: "22222222-2222-2222-2222-222222222202",
  testAdminPersonId: "44444444-4444-4444-4444-444444444401",
  testExecutorPersonId: "44444444-4444-4444-4444-444444444402",
  testAdminTelegramId: -1,
  testExecutorTelegramId: -2,
} as const;

/** Читает KEY=VALUE из source/.env.local (единственное место секретов вне CI). */
export function readEnvFileValue(name: string): string | undefined {
  const envPath = resolve(sourceDir, ".env.local");
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value === "" ? undefined : value;
  }
  return undefined;
}

/** Строка подключения: переменная среды, иначе .env.local; null — тесты пропускаются. */
export function testDatabaseUrl(): string | null {
  const fromEnv = process.env.TEST_DATABASE_URL?.trim();
  const url = fromEnv || readEnvFileValue("TEST_DATABASE_URL") || null;
  // Эти тесты делают TRUNCATE. Единственная разрешённая облачная БД — Sydney.
  if (url) {
    const parsed = new URL(url);
    if(parsed.port === "6543") throw new Error("Интеграционным тестам нужен session pooler (5432), чтобы удерживать блокировку");
    if (!(parsed.hostname.endsWith(".supabase.co") || parsed.hostname.endsWith(".supabase.com")) || !(parsed.hostname.includes("fuwsmewtmxmzttwkbdex") || parsed.username === "postgres.fuwsmewtmxmzttwkbdex")) {
      throw new Error("TEST_DATABASE_URL должен указывать только на тестовый проект fuwsmewtmxmzttwkbdex (Sydney)");
    }
  }
  return url;
}

export function createTestDb(): DbClient {
  const url = testDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL не задан — интеграционный тест запущен ошибочно");
  return createDbClient(url);
}

/**
 * Разбивает SQL-файл на отдельные операторы, понимая строки, комментарии
 * и dollar-quoted блоки ($$…$$, $tag$…$tag$) — миграции используют их
 * для DO-блоков и триггеров, поэтому наивное деление по ";" неприменимо.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  const push = (): void => {
    const body = current
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim();
    if (body !== "") statements.push(current.trim());
    current = "";
  };

  while (i < sql.length) {
    const ch = sql[i];
    // Строчный комментарий — до конца строки
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        current += sql[i];
        i++;
      }
      continue;
    }
    // Блочный комментарий (в PostgreSQL вкладывается)
    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      current += "/*";
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          current += "/*";
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          current += "*/";
          i += 2;
        } else {
          current += sql[i];
          i++;
        }
      }
      continue;
    }
    // Строковые литералы и идентификаторы в кавычках ('' — экранирование)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      current += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            current += quote + quote;
            i += 2;
            continue;
          }
          break;
        }
        current += sql[i];
        i++;
      }
      if (i < sql.length) {
        current += quote;
        i++;
      }
      continue;
    }
    // Dollar-quoted блок: $tag$ … $tag$
    if (ch === "$") {
      const match = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i));
      if (match) {
        const token = match[0];
        const end = sql.indexOf(token, i + token.length);
        if (end !== -1) {
          const close = end + token.length;
          current += sql.slice(i, close);
          i = close;
          continue;
        }
      }
    }
    if (ch === ";") {
      push();
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  push();
  return statements;
}

/** Применяет все миграции по порядку; они идемпотентны (IF NOT EXISTS, DO-блоки). */
export async function applyMigrations(exec: DbExecutor): Promise<number> {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const file of files) {
    const text = readFileSync(resolve(migrationsDir, file), "utf8");
    // postgres.js unsafe без параметров использует simple protocol: один
    // файл выполняется атомарно за один сетевой round-trip.
    await exec.query(text);
    count += splitSqlStatements(text).length;
  }
  return count;
}

/**
 * Применяет rls.sql — эталонный заслон (LLD-02 §16): снимает привилегии схемы
 * public у клиентских ролей и включает RLS на всех таблицах. Идемпотентен.
 * Назначение файла — коррекция дрейфа: на свежей БД (или после изменений
 * платформы Supabase) возвращает заслон к согласованному состоянию.
 */
export async function applyRlsShield(exec: DbExecutor): Promise<void> {
  const text = readFileSync(resolve(sourceDir, "db/rls.sql"), "utf8");
  await exec.query(text);
}

/**
 * Очищает все таблицы схемы public и заново применяет сид identity_dev.sql.
 * Вызывается перед каждым тестом: предсказуемый состав данных независимо
 * от порядка тестов и состояния общей dev-БД.
 *
 * audit_log очищается вместе со всеми: миграция 0003 (AUD-01) изымает у всех ролей,
 * включая postgres, право UPDATE/DELETE/TRUNCATE и ставит триггер на TRUNCATE.
 * Владелец таблицы (роль, под которой применялись миграции) на время очистки
 * отключает триггер и выдаёт себе TRUNCATE, после чего восстанавливает
 * исходное состояние защиты — та же модель доступа, что и в эксплуатации.
 */
export async function resetTestData(exec: DbExecutor): Promise<void> {
  const tables = await exec.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  if (tables.length === 0) return;
  // Защита снимается до truncate: каскад FK может задевать audit_log,
  // поэтому аудит-таблица должна быть в общем списке с уже выданным TRUNCATE.
  const list = tables.filter(t => !["time_rule", "time_rule_version", "request_category", "file_policy"].includes(t.tablename)).map((table) => `"${table.tablename}"`).join(", ");
  await exec.query("alter table audit_log disable trigger audit_log_append_only_truncate");
  await exec.query("grant truncate on audit_log to postgres");
  try {
    await exec.query(`truncate table ${list} cascade`);
  } finally {
    await exec.query("revoke truncate on audit_log from postgres");
    await exec.query("alter table audit_log enable trigger audit_log_append_only_truncate");
  }
  const seed = readFileSync(seedPath, "utf8");
  await exec.query(seed);
}

/**
 * describe-блок с чистой БД — см. with-db.ts (вынесен, чтобы globalSetup
 * не импортировал API vitest: он выполняется вне тестового контекста).
 */

/** Не держим один блокирующий SQL дольше серверного statement_timeout (120 с). */
export async function acquireTestDatabaseLock(exec: DbExecutor): Promise<void> {
  const deadline=Date.now()+30*60*1000;
  while(true) {
    const [row]=await exec.query<{acquired:boolean}>("select pg_try_advisory_lock(814733,3) as acquired");
    if(row?.acquired)return;
    if(Date.now()>=deadline)throw new Error("Тестовая БД занята более 30 минут; прогон не начат");
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
