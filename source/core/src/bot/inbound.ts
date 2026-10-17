import { TASK_COMMANDS, taskStep } from "./tasks.ts";
import { queueRequestFile } from "./request-files.ts";
import { REQUEST_COMMANDS, requestStep } from "./requests.ts";
import { jsonValue } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { registrationStep } from "./registration.ts";
import { notificationStep } from "./notifications.ts";
import { residentMenu, workerHelp, workerMenu, menuCommand } from "./help.ts";
import { notifyTelegram } from "../domains/registrations/notifications.ts";
import type { BotKind } from "./bots.ts";
import type { Row } from "../domains/registry/validation.ts";
import { type BotReply, replyText } from "./keyboard.ts";
import { botErrorText } from "./bot-errors.ts";
import { langOf, pick, type Lang } from "./text.ts";

/**
 * Маршрутизация шага внутри бота (ADR-009): файлы — в очередь загрузок,
 * у бота жителей далее анкета (по умолчанию) и обращения (REQ),
 * у бота сотрудников — задания (WRK), прочее — справка сотрудника.
 *
 * Слэш-команды не отдаются активному сценарию на съедание шагами ввода:
 * команды обращений — в requestStep, настройки уведомлений — в
 * notificationStep, остальное — в сценарий регистрации (он же справка).
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
    return queueRequestFile(deps, telegramId, message, updateId, bot);
  }
  const text = String(message.text);
  const isCommand = command.startsWith("/");
  // Глубокие ссылки (срез C): /start с payload открывает карточку без команд.
  // Номера кириллические («З-26-00001»), а payload Telegram допускает только
  // латиницу/цифры/_/-, поэтому ссылки строятся на UUID: req_<uuid> — обращение
  // в боте жителей, wrk_<uuid> — задание в боте сотрудников. Иной бот или
  // неизвестный payload — обычное поведение /start (справка/меню).
  const startPayload = command === "/start" ? text.trim().split(/\s+/)[1] : undefined;
  if (startPayload?.startsWith("req_") && bot === "resident") {
    return requestStep(deps, telegramId, `/request ${startPayload.slice(4)}`, undefined, operationId);
  }
  if (startPayload?.startsWith("wrk_") && bot === "worker") {
    return taskStep(deps, telegramId, `/task ${startPayload.slice(4)}`, undefined, operationId);
  }
  if (bot === "worker") {
    if (command === "/cancel") {
      // Сотрудник отменил сценарий; у жителя то же делает registrationStep.
      await deps.db.query(
        "update bot_dialog set state='{}'::text::jsonb,updated_at=now() where telegram_user_id=$1",
        [telegramId],
      );
      return workerHelp(await profileLang(deps.db, telegramId));
    }
    // Справка и старт доступны из любого сценария — глобальные выходы.
    if (command === "/help" || command === "/start") {
      return workerHelp(await profileLang(deps.db, telegramId));
    }
    // workerHelp() в fallback: язык профиля, а не всегда русский.
    return TASK_COMMANDS.includes(command) || (state.scenario === "tasks" && !isCommand)
      ? taskStep(deps, telegramId, text, undefined, operationId)
      : workerHelp(await profileLang(deps.db, telegramId));
  }
  if (isCommand) {
    if (command === "/notifications") {
      return notificationStep(deps, telegramId, text);
    }
    return REQUEST_COMMANDS.includes(command)
      ? requestStep(deps, telegramId, text, undefined, operationId)
      : registrationStep(deps, telegramId, text);
  }
  return state.scenario === "requests"
    ? requestStep(deps, telegramId, text, undefined, operationId)
    : registrationStep(deps, telegramId, text);
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
    // update_id уникален внутри одного бота; ключ дедупликации — пара (bot, update_id).
    const inserted = await exec.query(
      "insert into bot_inbound(bot,update_id,payload) values ($1,$2,$3::text::jsonb) on conflict do nothing returning update_id",
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
      const text =
        menuCommand(callbackData ?? String(message.text ?? "")) ??
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
        const [dialog] = await exec.query<{ state: unknown }>(
          "select state from bot_dialog where telegram_user_id=$1",
          [from.id],
        );
        const state = dialog ? jsonValue<Row>(dialog.state) : {};
        reply = await routeStep(
          { ...deps, db },
          bot,
          String(from.id),
          { ...message, text },
          state,
          command,
          `telegram:${update.update_id}`,
          update.update_id,
        );
      } catch (error) {
        await exec.query("rollback to savepoint bot_scenario");
        if (error instanceof ApiError) {
          reply = botErrorText(
            error,
            await profileLang(exec, String(from.id)),
          );
        } else if ((error as { code?: string }).code === "23505") {
          reply = pick(
            await profileLang(exec, String(from.id)),
            "Телефон или привязка уже существует. Требуется проверка администратора.",
            "Телефон немесе тіркелгі бар. Әкімшінің тексеруі қажет.",
          );
        } else throw error;
      }
      // Reply-меню прикрепляется к справке: постоянная клавиатура ставится
      // один раз и остаётся, пока пользователь её не скроет. Кнопки — подписи
      // на языке профиля; их тексты резолвятся в команды в processInbound.
      const menu = command === "/start" || command === "/help"
        ? await profileLang(exec, String(from.id)).then((lang) =>
          bot === "worker" ? workerMenu(lang) : residentMenu(lang)
        )
        : undefined;
      // Ответ уходит тем же ботом, который принял обновление.
      if (replyText(reply)) {
        await notifyTelegram(
          exec,
          from.id,
          reply,
          `update:${update.update_id}:reply`,
          bot,
          menu,
        );
      }
    }
    await exec.query(
      "update bot_inbound set status='processed',processed_at=now() where bot=$2 and update_id=$1",
      [update.update_id, bot],
    );
    return true;
  });
}
