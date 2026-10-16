// Функция bot-webhook — приём обновлений Telegram Bot API (LLD-01 §2, LLD-03 §6).
// VS-0: каркас защиты. Бизнес-сценарии бота — VS-2+ (анкета, заявка, приёмка).
//
// Защита: verify_jwt = false (обновления Telegram не несут JWT Supabase);
// проверка заголовка X-Telegram-Bot-Api-Secret-Token (LLD-03 §6):
//   не совпал — 401, тело запроса не читается;
//   секрет не настроен — 500 INTERNAL (ошибка конфигурации среды).
// Повторная доставка (тот же update_id) игнорируется — дедуп появится в VS-2
// вместе с таблицей bot_inbound (REQ-05); каркас не создаёт побочных эффектов.

import { type EnvSource } from "../../core/src/config/env.ts";
import { ApiError, toErrorResponse } from "../../core/src/errors/api.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const WEBHOOK_SECRET_ENV = "TELEGRAM_WEBHOOK_SECRET";

function health(): Response {
  return new Response(
    JSON.stringify({ status: "ok", service: "bot-webhook", time: new Date().toISOString() }),
    { status: 200, headers: JSON_HEADERS },
  );
}

// VS-0 тело синхронно; контракт Promise<Response> сохраняется для обработчиков VS-1+ (БД, очередь).
// deno-lint-ignore require-await
export async function handle(request: Request, env: EnvSource): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return health();
    }
    if (request.method !== "POST") {
      throw new ApiError("NOT_FOUND");
    }

    const expected = env(WEBHOOK_SECRET_ENV);
    if (expected === undefined) {
      // Секрет не задан: среда не настроена — обрабатывать обновления нельзя.
      throw new ApiError("INTERNAL", "Webhook secret не настроен в среде");
    }

    const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (provided !== expected) {
      // Не совпал — 401; тело намеренно не читается (LLD-03 §6).
      throw new ApiError("UNAUTHENTICATED");
    }

    // VS-0: сценарии бота отсутствуют — подтверждаем приём, эффекта нет.
    // Дедуп update_id и постановка в job_queue — VS-2 (REQ-05, LLD-03 §6).
    return new Response(
      JSON.stringify({ ok: true, status: "accepted", handled: false, reason: "vs0-stub" }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
  }
}

if (import.meta.main) {
  Deno.serve((request: Request) => handle(request, (name) => Deno.env.get(name)));
}
