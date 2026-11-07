#!/usr/bin/env node
// Обёртка над wrangler CLI: загружает source/.env.local (CLOUDFLARE_API_TOKEN,
// CLOUDFLARE_ACCOUNT_ID) и запускает npx wrangler@^4. Деплой Worker'а
// ассистента — вне CI (ADR-021), креды берутся из source/.env.local.
//
// Использование: node tools/scripts/wrangler-with-env.mjs <аргументы wrangler>
// Примеры (из source/):
//   node tools/scripts/wrangler-with-env.mjs --version
//   cd assistant && node ../tools/scripts/wrangler-with-env.mjs deploy
// Значения из .env.local не перекрывают уже установленные переменные среды.
// Сам файл секретов не читает и не печатает: значения уходят только в env процесса.

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
  process.exit(1);
}

if (!env.CLOUDFLARE_API_TOKEN) {
  console.error("[with-env] CLOUDFLARE_API_TOKEN не задан в source/.env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync("npx", ["--yes", "wrangler@^4", ...args], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
