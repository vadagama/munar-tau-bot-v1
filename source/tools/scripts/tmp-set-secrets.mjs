// Временный скрипт: ставит секреты функции api из .env.local без печати значений.
// SUPABASE_DB_URL = строка session pooler из TEST_DATABASE_URL (проверена
// tmp-db-check: подключение работает, миграции применены).
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";

const envPath = new URL("../../.env.local", import.meta.url);
if (!existsSync(envPath)) {
  console.error("нет .env.local");
  process.exit(1);
}
const vars = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)\s*$/);
  if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

// SUPABASE_JWT_SECRET берём из .env.local, если пользователь его добавил.
const secrets = {};
if (vars.SUPABASE_JWT_SECRET) secrets.SUPABASE_JWT_SECRET = vars.SUPABASE_JWT_SECRET;
if (vars.TEST_DATABASE_URL) secrets.SUPABASE_DB_URL = vars.TEST_DATABASE_URL;

const keys = Object.keys(secrets);
if (keys.length === 0) {
  console.error("нечего ставить: нет SUPABASE_DB_URL/TEST_DATABASE_URL");
  process.exit(1);
}

const tmpPath = new URL(".tmp-secrets.env", import.meta.url);
writeFileSync(tmpPath, keys.map((k) => `${k}=${secrets[k]}`).join("\n") + "\n");
chmodSync(tmpPath, 0o600);
try {
  const result = spawnSync(
    "npx",
    ["--yes", "supabase@^2", "secrets", "set", "--env-file", tmpPath.pathname, "--project-ref", vars.SUPABASE_PROJECT_ID],
    { stdio: "inherit", cwd: tmpPath.origin === undefined ? undefined : undefined },
  );
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(tmpPath);
}
console.log("Установлены секреты:", keys.join(", "));
if (!secrets.SUPABASE_JWT_SECRET) {
  console.log("SUPABASE_JWT_SECRET — ещё не задан (добавьте в .env.local и повторите, либо задайте вручную).");
}
