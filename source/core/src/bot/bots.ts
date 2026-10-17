// Два Telegram-бота ОСИ (ADR-009): бот жителей и бот сотрудников.
// resident — анкета регистрации, обращения (REQ), уведомления жителям;
// worker — задания исполнителей (WRK), файлы заданий, служебные уведомления
// (эскалации анкет, назначения, дежурство и аварии).
// Общий модуль обязателен: webhook, jobs и скрипты работают по одним правилам.

/** Какой из ботов: жительский или сотрудников ОСИ. */
export type BotKind = "resident" | "worker";

export const RESIDENT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const RESIDENT_WEBHOOK_SECRET_ENV = "TELEGRAM_WEBHOOK_SECRET";
export const WORKER_TOKEN_ENV = "TELEGRAM_WORKER_BOT_TOKEN";
export const WORKER_WEBHOOK_SECRET_ENV = "TELEGRAM_WORKER_WEBHOOK_SECRET";

/** Переменная среды с токеном бота. */
export function botTokenEnv(bot: BotKind): string {
  return bot === "worker" ? WORKER_TOKEN_ENV : RESIDENT_TOKEN_ENV;
}

/** Переменная среды с секретом webhook бота. */
export function botWebhookSecretEnv(bot: BotKind): string {
  return bot === "worker"
    ? WORKER_WEBHOOK_SECRET_ENV
    : RESIDENT_WEBHOOK_SECRET_ENV;
}

/**
 * Бот по пути webhook: `/bot-webhook/worker` — сотруднический,
 * `/bot-webhook[/resident]` — жительский (без суффикса — совместимость
 * с прежним адресом). Иной суффикс — null (неизвестный маршрут).
 */
export function botFromPath(pathname: string): BotKind | null {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  if (last === "worker" || last === "resident") return last;
  return last === "bot-webhook" ? "resident" : null;
}
