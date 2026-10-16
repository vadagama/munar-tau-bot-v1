// Временный обходной скрипт: supabase db push --db-url из TEST_DATABASE_URL.
// Новый CLI зависает на служебной роли cli_login_postgres через пулер,
// а прямое подключение (db.<ref>.supabase.co) недоступно без IPv6.
// Секреты не печатаются: строка подключения уходит только в аргумент процесса.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const envPath = new URL("../../.env.local", import.meta.url);
if (!existsSync(envPath)) {
  console.error("нет .env.local");
  process.exit(1);
}
let dbUrl;
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^TEST_DATABASE_URL=(.*)\s*$/);
  if (m) dbUrl = m[1].replace(/^["']|["']$/g, "").trim();
}
if (!dbUrl) {
  console.error("TEST_DATABASE_URL пуст");
  process.exit(1);
}
const result = spawnSync(
  "npx",
  ["--yes", "supabase@^2", "db", "push", "--db-url", dbUrl],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
