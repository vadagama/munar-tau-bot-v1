#!/usr/bin/env node
// Обёртка над supabase CLI: загружает source/.env.local (SUPABASE_PROJECT_ID,
// SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD) и запускает npx supabase@^2.
//
// Использование: node tools/scripts/supabase-with-env.mjs <аргументы CLI>
// Примеры (через npm-скрипты из source/):
//   npm run db:push        → supabase db push
//   npm run db:link        → supabase link
// Значения из .env.local не перекрывают уже установленные переменные среды.
// Сам файл секретов не читает и не печатает: значения уходят только в env процесса.
// Шаблон: tools/scripts/env.example.txt → скопируйте в source/.env.local.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(scriptDir, "../../.env.local");

const env = { ...process.env };

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "" && (env[key] === undefined || env[key] === "")) {
      env[key] = value;
    }
  }
} else {
  console.error(
    `[with-env] ${envPath} не найден. Скопируйте tools/scripts/env.example.txt в source/.env.local и заполните.`,
  );
}

const args = process.argv.slice(2);
const needsProjectRef = ["link", "push", "deploy", "functions", "secrets", "migration"].some((cmd) =>
  args.includes(cmd),
);
if (needsProjectRef && !args.includes("--project-ref") && env.SUPABASE_PROJECT_ID) {
  args.push("--project-ref", String(env.SUPABASE_PROJECT_ID));
}

const result = spawnSync("npx", ["--yes", "supabase@^2", ...args], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
