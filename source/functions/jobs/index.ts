// Функция jobs — фоновый обработчик по расписанию (LLD-01 §2, LLD-04 §1–3).
// VS-0: каркас вызова и защиты. Очередь job_queue, свип таймеров TIM и outbox — VS-1+.
//
// Защита (LLD-01 §2): verify_jwt = true (сервисный JWT платформой) + свой
// заголовок x-jobs-secret (значение — из env, регистрируется cron-заданием
// через Vault; шаблон — db/migrations/0002_schedule.sql).
// Бюджет вызова: порции до ~50 с и завершение — норма для VS-1+ (LLD-04 §1).

import { type EnvSource } from "../../core/src/config/env.ts";
import { ApiError, toErrorResponse } from "../../core/src/errors/api.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const JOBS_SECRET_ENV = "X_JOBS_SECRET";

function health(): Response {
  return new Response(
    JSON.stringify({ status: "ok", service: "jobs", time: new Date().toISOString() }),
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

    const expected = env(JOBS_SECRET_ENV);
    if (expected === undefined) {
      throw new ApiError("INTERNAL", "Jobs secret не настроен в среде");
    }

    const provided = request.headers.get("x-jobs-secret");
    if (provided !== expected) {
      throw new ApiError("UNAUTHENTICATED");
    }

    // VS-0: обработчиков очереди нет — вызов успешен, обработано 0 задач.
    // В VS-1+: аварийный возврат running-задач, свип TIM, слив job_queue (LLD-04 §3).
    return new Response(
      JSON.stringify({ status: "ok", processed: 0, note: "vs0-stub" }),
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
