import { REPORT_COMMANDS,reportStep } from "./reports.ts";
import { queueInitiativePhoto } from "./initiative-files.ts";
import { INITIATIVE_COMMANDS,initiativeStep } from "./initiatives.ts";
import { lockAudience } from "../domains/registry/audience-lock.ts";
import { navigationReply } from "./navigation.ts";
import { POLL_COMMANDS, pollStep } from "./polls.ts";
import { DOCUMENT_COMMANDS, documentStep, queueDocumentFile } from "./documents.ts";
import { STAFF_REQUEST_COMMANDS, staffRequestStep } from "./staff-requests.ts";
import { readDialog, saveDialog } from "./dialog.ts";
import { t as templateText } from "../templates/store.ts";
import { loadTemplateStore } from "../templates/store.ts";
import { TASK_COMMANDS, taskStep } from "./tasks.ts";
import { queueRequestFile } from "./request-files.ts";
import { REQUEST_COMMANDS, requestStep } from "./requests.ts";
import { INCIDENT_COMMANDS, incidentStep } from "./incidents.ts";
import { ApiError } from "../errors/api.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { registrationStep } from "./registration.ts";
import { notificationStep } from "./notifications.ts";
import { menuCommand, workerHelp } from "./help.ts";
import { notifyTelegram } from "../domains/registrations/notifications.ts";
import type { BotKind } from "./bots.ts";
import type { Row } from "../domains/registry/validation.ts";
import { type BotReply, replyText } from "./keyboard.ts";
import { botErrorText } from "./bot-errors.ts";
import { type Lang, langOf } from "./text.ts";
import { syncTelegramUsername } from "./telegram-username.ts";

/**
 * Маршрутизация шага внутри бота (ADR-009): файлы — в очередь загрузок,
 * у бота жителей далее анкета (по умолчанию) и обращения (REQ),
 * у бота сотрудников — задания (WRK), прочее — справка сотрудника.
 *
 * Слэш-команды не отдаются активному сценарию на съедание шагами ввода:
 * команды обращений — в requestStep, инцидентов и публикаций (EMG/PUB) —
 * в incidentStep, настройки уведомлений — в notificationStep, остальное —
 * в сценарий регистрации (он же справка).
 * Иначе застреваешь в шаге выбора помещения: любая команда отвечает
 * «Выберите номер из списка» (инцидент 17.10.2026).
 */
async function routeStep(
  deps: RegistryDeps,
  bot: BotKind,
  telegramId: string,
  message: Row,
  state: Row,
  command: string,
  operationId: string,
  updateId: unknown,
): Promise<BotReply> {
  if (message.photo || message.document || message.video) {
    if (state.scenario === "reports") return reportStep(deps,telegramId,deps.bot==="worker"?"/mywork":"/plans");
    if (state.scenario === "initiatives") return queueInitiativePhoto(deps,telegramId,message,updateId);
    if (state.scenario === "polls") return pollStep(deps, telegramId, "");
    if (state.scenario === "documents") return queueDocumentFile(deps, telegramId, message);
    return queueRequestFile(deps, telegramId, message, updateId, bot);
  }
  const text = String(message.text);
  const isCommand = command.startsWith("/");
  // Глубокие ссылки (срез C): /start с payload открывает карточку без команд.
  // Номера кириллические («З-26-00001»), а payload Telegram допускает только
  // латиницу/цифры/_/-, поэтому ссылки строятся на UUID: req_<uuid> — обращение
  // в боте жителей, wrk_<uuid> — задание в боте сотрудников. Иной бот или
  // неизвестный payload — обычное поведение /start (справка/меню).
  const startPayload = command === "/start"
    ? text.trim().split(/\s+/)[1]
    : undefined;
  if (REPORT_COMMANDS.includes(command)) return reportStep(deps,telegramId,text);
  if (startPayload?.startsWith("idea_")||startPayload?.startsWith("mod_")) return initiativeStep(deps,telegramId,text);
  if (INITIATIVE_COMMANDS.includes(command)||(state.scenario==="initiatives"&&!isCommand)) return initiativeStep(deps,telegramId,text);
  if (startPayload?.startsWith("poll_")) return pollStep(deps, telegramId, `/poll ${startPayload.slice(5)}`);
  if (POLL_COMMANDS.includes(command) || (state.scenario === "polls" && !isCommand)) return pollStep(deps, telegramId, text);
  if (startPayload?.startsWith("doc_")) return documentStep(deps, telegramId, `/doc ${startPayload.slice(4)}`);
  if (DOCUMENT_COMMANDS.includes(command) || (state.scenario === "documents" && !isCommand)) return documentStep(deps, telegramId, text);
  if (startPayload?.startsWith("req_") && bot === "resident") {
    return requestStep(
      deps,
      telegramId,
      `/request ${startPayload.slice(4)}`,
      undefined,
      operationId,
    );
  }
  if (startPayload?.startsWith("wrk_") && bot === "worker") {
    return taskStep(
      deps,
      telegramId,
      `/task ${startPayload.slice(4)}`,
      undefined,
      operationId,
    );
  }
  if (bot === "worker") {
    if (command === "/notifications") return notificationStep(deps,telegramId,text);
    if (STAFF_REQUEST_COMMANDS.includes(command) ||
      (command === "/start" && (startPayload?.startsWith("sreq_") || startPayload?.startsWith("stsk_"))) ||
      (state.scenario === "staff-requests" && !isCommand)) {
      return staffRequestStep(deps, telegramId, text);
    }
    if (command === "/cancel") {
      // Сотрудник отменил сценарий; у жителя то же делает registrationStep.
      await saveDialog(deps.db, telegramId, bot, {});
      return workerHelp(await profileLang(deps.db, telegramId), deps.templates);
    }
    // Справка и старт доступны из любого сценария — глобальные выходы.
    if (command === "/help" || command === "/start") {
      await saveDialog(deps.db,telegramId,bot,{});
      return workerHelp(await profileLang(deps.db, telegramId), deps.templates);
    }
    // workerHelp() в fallback: язык профиля, а не всегда русский.
    if (
      TASK_COMMANDS.includes(command) ||
      (state.scenario === "tasks" && !isCommand)
    ) {
      return taskStep(deps, telegramId, text, undefined, operationId);
    }
    // Продолжение диалога о проблеме после работ (кнопка публикации).
    if (
      (state.scenario === "incidents" && !isCommand) ||
      INCIDENT_COMMANDS.includes(command)
    ) {
      return incidentStep(deps, telegramId, text, undefined, operationId);
    }
    return workerHelp(await profileLang(deps.db, telegramId), deps.templates);
  }
  if (isCommand) {
    if (command === "/notifications") {
      return notificationStep(deps, telegramId, text);
    }
    if (INCIDENT_COMMANDS.includes(command)) {
      return incidentStep(deps, telegramId, text, undefined, operationId);
    }
    return REQUEST_COMMANDS.includes(command)
      ? requestStep(deps, telegramId, text, undefined, operationId)
      : registrationStep(deps, telegramId, text);
  }
  if (state.scenario === "requests") {
    return requestStep(deps, telegramId, text, undefined, operationId);
  }
  if (state.scenario === "incidents") {
    // Свободный текст в сценарии инцидентов — продолжение /workproblem.
    return incidentStep(deps, telegramId, text, undefined, operationId);
  }
  return registrationStep(deps, telegramId, text);
}

/** Язык профиля для подачи ответа; профиля нет — русский. */
async function profileLang(
  exec: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  telegramId: string,
): Promise<Lang> {
  const [row] = await exec.query<{ language: string }>(
    "select language from profile where telegram_user_id=$1 and archived_at is null limit 1",
    [telegramId],
  );
  return langOf(row?.language);
}

export async function processInbound(
  deps: RegistryDeps,
  update: Row,
  bot: BotKind = "resident",
): Promise<boolean> {
  if (!Number.isSafeInteger(update.update_id)) {
    throw new ApiError("VALIDATION_FAILED", "Некорректный update_id");
  }
  return deps.db.transaction(async (exec) => {
    await lockAudience(exec);
    // update_id уникален внутри одного бота; ключ дедупликации — пара (bot, update_id).
    const inserted = await exec.query(
      "insert into bot_inbound(bot,update_id,payload) values ($1,$2,$3::text::jsonb) on conflict (bot,update_id) do update set status='received',error=null where bot_inbound.status='error' returning update_id",
      [bot, update.update_id, JSON.stringify(update)],
    );
    if (!inserted.length) return false;
    // Срез UX B: нажатие inline-кнопки исполняется как её текстовый эквивалент —
    // callback_data равен команде, которую пользователь мог бы набрать сам.
    const callback = update.callback_query as Row | undefined;
    const message = (update.message ?? callback?.message) as Row | undefined;
    const from = (callback?.from ?? message?.from) as Row | undefined,
      chat = message?.chat as Row | undefined;
    const callbackData = typeof callback?.data === "string" && callback.data
      ? callback.data
      : undefined;
    if (
      message &&
      from &&
      chat &&
      Number.isSafeInteger(from.id) &&
      from.id === chat.id &&
      chat.type === "private" &&
      (callbackData !== undefined || typeof message.text === "string" ||
        message.photo || message.document || message.video)
    ) {
      // Текст кнопки reply-меню исполняется как её команда: кнопка отправляет
      // подпись, а не текстовую команду (map в help.ts).
      const templates = await loadTemplateStore(exec);
      const text =
        menuCommand(callbackData ?? String(message.text ?? ""), templates) ??
          callbackData ?? String(message.text ?? "");
      const command = text.split(/\s+/)[0] ?? "";
      await exec.query("savepoint bot_scenario");
      let reply: BotReply = "";
      try {
        const db = {
          ...deps.db,
          query: exec.query.bind(exec),
          transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
        };
        const state = await readDialog(exec, String(from.id), bot);
        reply = await routeStep(
          { ...deps, db, templates, bot },
          bot,
          String(from.id),
          { ...message, text },
          state,
          command,
          `telegram:${bot}:${update.update_id}`,
          update.update_id,
        );
      } catch (error) {
        await exec.query("rollback to savepoint bot_scenario");
        if (error instanceof ApiError) {
          reply = botErrorText(
            error,
            await profileLang(exec, String(from.id)),
            templates,
          );
        } else if ((error as { code?: string }).code === "23505") {
          reply = templateText(
            templates,
            await profileLang(exec, String(from.id)),
            "common.telefon_ili_privyazka_uzhe_suschestvuet_trebuetsya_proverka",
          );
        } else throw error;
      }
      const currentState = await readDialog(exec,String(from.id),bot);
      reply = navigationReply(reply,String(currentState.scenario ?? (bot === "worker" ? "tasks" : "registration")),await profileLang(exec,String(from.id)),templates,text);
      // Ответ уходит тем же ботом, который принял обновление.
      if (replyText(reply)) {
        await notifyTelegram(
          exec,
          from.id,
          reply,
          `update:${update.update_id}:reply`,
          bot,
        );
      }
      // Имя в Telegram — display-only метаданные (ADR-001/004); синхронизация
      // после сценария, чтобы снимок попал и во вновь созданную анкету. Сбой
      // не должен ломать обработку обновления — savepoint + продолжение.
      await exec.query("savepoint sync_telegram_username");
      try {
        await syncTelegramUsername(exec, String(from.id), from.username);
      } catch (error) {
        await exec.query("rollback to savepoint sync_telegram_username");
        console.error("telegram_username sync failed", error);
      }
    }
    await exec.query(
      "update bot_inbound set status='processed',processed_at=now() where bot=$2 and update_id=$1",
      [update.update_id, bot],
    );
    return true;
  });
}
