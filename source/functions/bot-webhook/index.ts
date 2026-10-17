// Функция bot-webhook — приём обновлений Telegram Bot API (LLD-01 §2, LLD-03 §6).
// VS-2: анкета и приглашения через общий сценарий бота/эмуляции.
//
// Защита: verify_jwt = false (обновления Telegram не несут JWT Supabase);
// два бота различаются суффиксом пути (ADR-009): /bot-webhook/resident — жители,
// /bot-webhook/worker — сотрудники (базовый путь без суффикса — жители, для
// совместимости с зарегистрированным webhook). Секрет каждого бота — своя
// переменная среды (X-Telegram-Bot-Api-Secret-Token, LLD-03 §6):
//   не совпал — 401, тело запроса не читается;
//   секрет не настроен — 500 INTERNAL (ошибка конфигурации среды).
// Повторная доставка update_id игнорируется в общей транзакции bot_inbound
// (ключ bot+update_id — нумерации у ботов независимы)
// и бизнес-сценария; ответ ставится в устойчивую очередь уведомлений.

import { botFromPath, botWebhookSecretEnv } from "../../core/src/bot/bots.ts";
import { processInbound } from "../../core/src/bot/inbound.ts";
import { createDbClient } from "../../core/src/db/client.ts";
import { SqlAuditRepo } from "../../core/src/domains/audit/repo.ts";
import type { RegistryDeps } from "../../core/src/domains/registry/service.ts";
import { requireEnv } from "../../core/src/config/env.ts";
import { type EnvSource } from "../../core/src/config/env.ts";
import { ApiError, toErrorResponse } from "../../core/src/errors/api.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const WEBHOOK_SECRET_ENV = "TELEGRAM_WEBHOOK_SECRET";

function health(): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "bot-webhook",
      time: new Date().toISOString(),
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

// Секрет проверяется до чтения тела и подключения к БД.
export async function handle(
  request: Request,
  env: EnvSource,
  deps?: RegistryDeps,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return health();
    }
    if (request.method !== "POST") {
      throw new ApiError("NOT_FOUND");
    }

    // Бот определяется путём до чтения тела: неизвестный маршрут — 404.
    const bot = botFromPath(url.pathname);
    if (!bot) throw new ApiError("NOT_FOUND");

    const expected = env(botWebhookSecretEnv(bot));
    if (expected === undefined) {
      // Секрет не задан: среда не настроена — обрабатывать обновления нельзя.
      throw new ApiError("INTERNAL", "Webhook secret не настроен в среде");
    }

    const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (provided !== expected) {
      // Не совпал — 401; тело намеренно не читается (LLD-03 §6).
      throw new ApiError("UNAUTHENTICATED");
    }

    if (Number(request.headers.get("content-length") ?? 0) > 65536)
      throw new ApiError("FILE_LIMIT");
    const raw = await request.text();
    if (raw.length > 65536) throw new ApiError("FILE_LIMIT");
    let update;
    try {
      update = JSON.parse(raw);
    } catch {
      throw new ApiError("VALIDATION_FAILED", "Ожидается JSON Telegram update");
    }
    if (!update || typeof update !== "object" || Array.isArray(update))
      throw new ApiError("VALIDATION_FAILED");
    const actual = deps ?? {
      // Клиент на один вызов (закрывается в finally); max: 2 ограничивает
      // всплеск при параллельных обновлениях (см. комментарий в api/deps.ts).
      db: createDbClient(requireEnv(env, "SUPABASE_DB_URL"), { max: 2 }),
      audit: new SqlAuditRepo(),
    };
    try {
      const handled = await processInbound(actual, update, bot);
      return new Response(JSON.stringify({ ok: true, handled }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    } finally {
      if (!deps) await actual.db.close();
    }
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return new Response(JSON.stringify(body), {
      status,
      headers: JSON_HEADERS,
    });
  }
}

if (import.meta.main) {
  Deno.serve((request: Request) =>
    handle(request, (name) => Deno.env.get(name)),
  );
}
