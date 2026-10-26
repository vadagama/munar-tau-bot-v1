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

/**
 * Нижняя граница зарезервированного диапазона telegram_user_id для сид-заглушек
 * (9000000000NN). Реальные id Telegram сегодня существенно ниже; заглушечный id
 * в реальной доставке обречён (chat not found) и порождал шторм ретраев
 * (инцидент 2026-10-23). Диапазон закреплён CHECK-констрейнтом в БД
 * (миграция 20261023193000_placeholder_telegram_ids) и страховкой доставки.
 */
export const TELEGRAM_PLACEHOLDER_ID_MIN = 900_000_000_000;

/** Id из зарезервированного диапазона заглушек — реальному Telegram не соответствует. */
export function isPlaceholderTelegramId(telegramUserId: string | number): boolean {
  return Number(telegramUserId) >= TELEGRAM_PLACEHOLDER_ID_MIN;
}

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
