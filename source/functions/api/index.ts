// Функция api — единый роутер REST /v1 (LLD-01 §2, LLD-03).
// VS-0: каркас транспорта. Только health без аутентификации (LLD-03 §3.1);
// аутентификация, PDP и бизнес-маршруты приходят в VS-1+ — все прочие запросы
// отвечают 401 UNAUTHENTICATED в формате ошибок LLD-03 §1.1.
//
// Защита: verify_jwt = true (проверка Bearer JWT платформой Supabase,
// см. supabase/config.toml); проверка профиля и полномочий — в VS-1.

import { type EnvSource } from "../../core/src/config/env.ts";
import { ApiError, toErrorResponse } from "../../core/src/errors/api.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Ответ health-check: без персональных данных (LLD-03 §3.1, OPS-02). */
function health(): Response {
  return new Response(
    JSON.stringify({ status: "ok", service: "api", time: new Date().toISOString() }),
    { status: 200, headers: JSON_HEADERS },
  );
}

/**
 * Обработка запроса. env передаётся источником значений (тестируемость,
 * ADR-003); секреты не логируются и не попадают в ответы.
 */
// VS-0 тело синхронно; контракт Promise<Response> сохраняется для обработчиков VS-1+ (БД, очередь).
// deno-lint-ignore require-await
export async function handle(request: Request, env: EnvSource): Promise<Response> {
  try {
    const url = new URL(request.url);
    // Путь внутри функции: /functions/v1/api/v1/... → нормализуем к /v1/...
    const path = url.pathname.slice(url.pathname.indexOf("/v1/"));

    if (request.method === "GET" && path === "/v1/meta/health") {
      return health();
    }

    // VS-0: аутентификации ещё нет — любой прочий маршрут отвечает 401
    // (deny-by-default, LLD-03 §1). Наличие валидного JWT здесь не проверяется.
    void env; // env понадобится в VS-1 (JWT secret/профиль); заглушка без побочных эффектов
    throw new ApiError("UNAUTHENTICATED");
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
  }
}

if (import.meta.main) {
  Deno.serve((request: Request) => handle(request, (name) => Deno.env.get(name)));
}
