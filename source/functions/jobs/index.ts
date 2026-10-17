import { sweepRequests } from "../../core/src/domains/requests/jobs.ts";
import { processRequestUploads } from "../../core/src/bot/request-files.ts";
import { SupabaseFileStorage } from "../../core/src/domains/requests/files.ts";
import { processImportBatches } from "../../core/src/domains/registry/import.ts";
import { createDbClient } from "../../core/src/db/client.ts";
import { SqlAuditRepo } from "../../core/src/domains/audit/repo.ts";
import { requireEnv } from "../../core/src/config/env.ts";
import {
  sweepRegistrations,
  sendNotifications,
  type TelegramSender,
} from "../../core/src/domains/registrations/jobs.ts";
import type { RegistryDeps } from "../../core/src/domains/registry/service.ts";
// Функция jobs — фоновый обработчик по расписанию (LLD-01 §2, LLD-04 §1–3).
// VS-2: свип регистрации, проверка импорта и доставка уведомлений.
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
    JSON.stringify({
      status: "ok",
      service: "jobs",
      time: new Date().toISOString(),
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

// Ограниченный бюджет одного запуска; необработанные записи остаются в БД.
export async function handle(
  request: Request,
  env: EnvSource,
  deps?: RegistryDeps,
  sender?: TelegramSender,
): Promise<Response> {
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

    const actual = deps ?? {
      db: createDbClient(requireEnv(env, "SUPABASE_DB_URL")),
      audit: new SqlAuditRepo(),
    };
    try {
      const deadline = Date.now() + 45000;
      const files = !deps && env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY") && env("TELEGRAM_BOT_TOKEN") ? await processRequestUploads(actual,new SupabaseFileStorage(requireEnv(env,"SUPABASE_URL"),requireEnv(env,"SUPABASE_SERVICE_ROLE_KEY")),requireEnv(env,"TELEGRAM_BOT_TOKEN"),deadline) : 0;
      const processed = files +
        (await sweepRegistrations(actual, new Date(), deadline)) +
        (await processImportBatches(actual, deadline)) +
        (deps ? 0 : await sweepRequests(actual,deadline));
      const send: TelegramSender =
        sender ??
        (async (chatId, text) => {
          const token = requireEnv(env, "TELEGRAM_BOT_TOKEN");
          const response = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text }),
              signal: AbortSignal.timeout(10000),
            },
          );
          const result = await response.json();
          if (!response.ok || result.ok !== true)
            throw Object.assign(new Error(`TELEGRAM_${response.status}`), {
              retryAfter: result.parameters?.retry_after,
              blocked: response.status === 403,
            });
        });
      const sent = await sendNotifications(actual, send, deadline);
      return new Response(JSON.stringify({ status: "ok", processed, sent }), {
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
