import { reconcileInitiativeSupport } from "../../core/src/domains/initiatives/reconcile.ts";
import { reconcileOpenPolls } from "../../core/src/domains/polls/reconcile.ts";
import { closeDuePolls } from "../../core/src/domains/polls/jobs.ts";
import { publishScheduled } from "../../core/src/domains/publications/jobs.ts";
import { sweepDocumentObligations } from "../../core/src/domains/documents/jobs.ts";
import { reopenFinancialObligations, sweepFinancialObligations } from "../../core/src/domains/publications/financial-jobs.ts";
import { sweepEmergencies } from "../../core/src/domains/incidents/jobs.ts";
import { fanoutBroadcasts } from "../../core/src/domains/incidents/broadcast.ts";
import {
  enqueueSchedules,
  processScheduledJobs,
} from "../../core/src/domains/tasks/schedule.ts";
import { sweepTaskTimers } from "../../core/src/domains/tasks/timing.ts";
import { dispatchNotices } from "../../core/src/domains/notifications/service.ts";
import { sweepDigests } from "../../core/src/domains/notifications/digest.ts";
import { sweepConfirmationTimers } from "../../core/src/domains/timing/request-timers.ts";
import { sweepRequests } from "../../core/src/domains/requests/jobs.ts";
import { processRequestUploads } from "../../core/src/bot/request-files.ts";
import { botTokenEnv, type BotKind } from "../../core/src/bot/bots.ts";
import { SupabaseFileStorage } from "../../core/src/domains/requests/files.ts";
import { processImportBatches } from "../../core/src/domains/registry/import.ts";
import { createDbClient } from "../../core/src/db/client.ts";
import { SqlAuditRepo } from "../../core/src/domains/audit/repo.ts";
import { requireEnv } from "../../core/src/config/env.ts";
import {
  sendNotifications,
  sweepRegistrations,
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

/**
 * Отправка sendMessage с разметкой HTML, выключенным превью ссылок и
 * необязательной клавиатурой (срез UX B). Если Telegram отклонил запрос
 * (400 — например, в тексте случайный «<» или сломана разметка), сообщение
 * повторяется: с клавиатурой без parse_mode, затем совсем без клавиатуры —
 * доставка важнее оформления.
 */
export async function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  replyMarkup?: unknown,
): Promise<void> {
  const base: Record<string, unknown> = { chat_id: chatId, text };
  const attempts: Record<string, unknown>[] = [
    {
      ...base,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    },
  ];
  // Отказ 400: без parse_mode, но с клавиатурой; затем совсем без клавиатуры.
  if (replyMarkup !== undefined) attempts.push({ ...base, reply_markup: replyMarkup });
  attempts.push({ ...base });
  let response!: Response;
  let result: Record<string, unknown> = {};
  for (const payload of attempts) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    response = res;
    result = await res.json().catch(() => ({}));
    if (res.ok && result.ok === true) return;
    if (res.status !== 400) break;
  }
  if (!response.ok || result.ok !== true) {
    const parameters = result.parameters as { retry_after?: number } | undefined;
    throw Object.assign(new Error(`TELEGRAM_${response.status}`), {
      retryAfter: parameters?.retry_after,
      blocked: response.status === 403,
    });
  }
}

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
      // Клиент на один вызов (закрывается в finally); max: 2 ограничивает
      // параллельные тики расписания (см. комментарий в api/deps.ts).
      db: createDbClient(requireEnv(env, "SUPABASE_DB_URL"), { max: 2 }),
      audit: new SqlAuditRepo(),
    };
    try {
      return await actual.db.transaction(async (guard) => {
        const [lock] = await guard.query<{ acquired: boolean }>(
          "select pg_try_advisory_xact_lock(814733,6) as acquired",
        );
        if (!lock?.acquired) {
          return new Response(
            JSON.stringify({ status: "ok", processed: 0, sent: 0, busy: true }),
            { headers: JSON_HEADERS },
          );
        }
        const deadline = Date.now() + 45000;
        const backgroundDeadline = deadline - 15000;
        const files =
          !deps && env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY") &&
            // Загрузка файлов требует оба токена: file_id привязан к боту,
            // принявшему файл, — без worker-токена его задания не обработать.
            env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_WORKER_BOT_TOKEN")
            ? await processRequestUploads(
              actual,
              new SupabaseFileStorage(
                requireEnv(env, "SUPABASE_URL"),
                requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
              ),
              {
                resident: requireEnv(env, "TELEGRAM_BOT_TOKEN"),
                worker: requireEnv(env, "TELEGRAM_WORKER_BOT_TOKEN"),
              },
              backgroundDeadline,
            )
            : 0;
        const processed = files +
          (await sweepEmergencies(actual,new Date(),backgroundDeadline)) +
          (await closeDuePolls(actual,backgroundDeadline)) +
          (await reconcileOpenPolls(actual,backgroundDeadline)) +
          (await reconcileInitiativeSupport(actual,backgroundDeadline)) +
          (await sweepDocumentObligations(actual,backgroundDeadline)) +
          (await reopenFinancialObligations(actual,backgroundDeadline)) +
          (await sweepFinancialObligations(actual,backgroundDeadline)) +
          (await publishScheduled(actual,backgroundDeadline)) +
          (await sweepRegistrations(actual, new Date(), backgroundDeadline)) +
          (await processImportBatches(actual, backgroundDeadline)) +
          (await sweepRequests(actual, backgroundDeadline)) +
          (await sweepTaskTimers(actual, new Date(), backgroundDeadline)) +
          (await enqueueSchedules(actual, new Date(), backgroundDeadline)) +
          (await processScheduledJobs(actual, backgroundDeadline)) +
          (await sweepConfirmationTimers(
            actual,
            new Date(),
            backgroundDeadline,
          )) +
          (await fanoutBroadcasts(actual, backgroundDeadline)) +
          (await dispatchNotices(actual, deadline - 10000)) +
          (await sweepDigests(actual, new Date(), deadline - 10000));
        const send: TelegramSender = sender ??
          ((chatId, text, bot: BotKind, replyMarkup?: unknown) =>
            telegramSendMessage(
              requireEnv(env, botTokenEnv(bot)),
              chatId,
              text,
              replyMarkup,
            ));
        const sent = await sendNotifications(actual, send, deadline);
        return new Response(JSON.stringify({ status: "ok", processed, sent }), {
          status: 200,
          headers: JSON_HEADERS,
        });
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
    handle(request, (name) => Deno.env.get(name))
  );
}
