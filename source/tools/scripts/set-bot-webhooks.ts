// Регистрация webhook двух ботов ОСИ ЖК «Мунар Тау» в Telegram (ADR-009).
// Из source/: deno run --env-file=.env.local --allow-env --allow-net tools/scripts/set-bot-webhooks.ts
//
// Адреса: <SUPABASE_URL>/functions/v1/bot-webhook/resident и .../worker;
// без SUPABASE_URL берётся https://<SUPABASE_PROJECT_ID>.supabase.co.
// Секреты: TELEGRAM_WEBHOOK_SECRET и TELEGRAM_WORKER_WEBHOOK_SECRET
// (совпадают с секретами функций; не коммитятся, не печатаются).
// Повторный запуск безопасен: setWebhook просто перезаписывает адрес.
// allowed_updates задаётся явно: опущенный параметр Telegram сохраняет
// прежний фильтр (документация setWebhook), из-за чего однажды
// зарегистрированный ["message"] навсегда отсекал callback_query —
// нажатия кнопок не доходили до вебхука (инцидент 17.10.2026).

import {
  botTokenEnv,
  botWebhookSecretEnv,
  type BotKind,
} from "../../core/src/bot/bots.ts";

// Telegram принимает секрет только из этих символов (1–256).
const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

interface BotConfig {
  kind: BotKind;
  suffix: string;
  label: string;
}

const BOTS: BotConfig[] = [
  { kind: "resident", suffix: "resident", label: "бот жителей" },
  { kind: "worker", suffix: "worker", label: "бот сотрудников" },
];

const base = Deno.env.get("SUPABASE_URL") ??
  (Deno.env.get("SUPABASE_PROJECT_ID")
    ? `https://${Deno.env.get("SUPABASE_PROJECT_ID")}.supabase.co`
    : undefined);
if (!base) {
  console.error(
    "Не задан ни SUPABASE_URL, ни SUPABASE_PROJECT_ID — адрес функций неизвестен.",
  );
  Deno.exit(1);
}

async function callBot(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json() as {
    ok?: boolean;
    result?: Record<string, unknown>;
    description?: string;
  };
  if (!response.ok || !result.ok || !result.result) {
    throw new Error(
      `${method}: HTTP ${response.status} ${
        result.description ?? "неизвестная ошибка"
      }`,
    );
  }
  return result.result;
}

let failures = 0;
let registered = 0;
for (const bot of BOTS) {
  const tokenEnv = botTokenEnv(bot.kind);
  const secretEnv = botWebhookSecretEnv(bot.kind);
  const token = Deno.env.get(tokenEnv);
  const secret = Deno.env.get(secretEnv);
  if (!token) {
    console.warn(`[пропуск] ${bot.label}: ${tokenEnv} не задан.`);
    continue;
  }
  if (!secret) {
    console.error(
      `[ошибка] ${bot.label}: ${secretEnv} не задан — без секрета webhook не регистрируется.`,
    );
    failures++;
    continue;
  }
  if (!SECRET_PATTERN.test(secret)) {
    console.error(
      `[ошибка] ${bot.label}: ${secretEnv} не подходит для Telegram (допустимы A-Z a-z 0-9 _ -, длина 1–256).`,
    );
    failures++;
    continue;
  }
  const url = `${base}/functions/v1/bot-webhook/${bot.suffix}`;
  try {
    await callBot(token, "getMe", {});
    await callBot(token, "setWebhook", {
      url,
      secret_token: secret,
      // Текстовые команды и нажатия inline-кнопок (callback_data = команда).
      allowed_updates: ["message", "callback_query"],
    });
    const info = await callBot(token, "getWebhookInfo", {});
    if (info.url !== url) {
      throw new Error(
        `getWebhookInfo вернул другой адрес: ${String(info.url)}`,
      );
    }
    const allowed = (info.allowed_updates as string[] | undefined) ?? [];
    if (!allowed.includes("callback_query")) {
      throw new Error(
        `getWebhookInfo не показывает callback_query в allowed_updates: ${JSON.stringify(allowed)} — кнопки не будут работать`,
      );
    }
    console.log(`[ok] ${bot.label}: ${url}`);
    if (info.last_error_message) {
      console.warn(
        `[внимание] ${bot.label}: последняя ошибка доставки — ${String(info.last_error_message)}`,
      );
    }
    registered++;
  } catch (error) {
    console.error(
      `${bot.label}: ошибка обращения к Telegram API:`,
      error instanceof Error ? error.message : error,
    );
    failures++;
  }
}
if (registered === 0 && failures === 0) {
  console.error(
    "Не задан ни один токен ботов (TELEGRAM_BOT_TOKEN, TELEGRAM_WORKER_BOT_TOKEN).",
  );
  Deno.exit(1);
}
if (failures > 0) Deno.exit(1);
console.log(`Готово: зарегистрировано webhook — ${registered} из ${BOTS.length}.`);
