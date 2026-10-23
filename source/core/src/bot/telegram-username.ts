import type { DbExecutor } from "../db/client.ts";

/**
 * Имя в Telegram (@username) — display-only метаданные каталогов кабинета.
 * ADR-001/ADR-004: username не хранится как ключ и не участвует в
 * аутентификации, сопоставлении и авторизации; для этого служат
 * telegram_user_id и auth.identities.
 */

/** Анкеты, по которым снимок имени ещё актуален для проверки. */
const ACTIVE_REGISTRATION_STATES = "('pending_review','need_clarification','disputed')";

/** Username по правилам Telegram: 5–32 символа [A-Za-z0-9_]; нет/некорректный — null. */
export function normalizeTelegramUsername(username: unknown): string | null {
  if (typeof username !== "string") return null;
  const name = username.trim();
  return /^[A-Za-z0-9_]{5,32}$/.test(name) ? name : null;
}

/**
 * Актуализация имени по входящему обновлению: текущий профиль (по
 * telegram_user_id) и снимок в активных анкетах. Отсутствие username
 * (пользователь убрал имя) очищает значение. Вызывается best-effort:
 * сбой не должен ломать обработку обновления.
 */
export async function syncTelegramUsername(
  exec: DbExecutor,
  telegramId: string,
  username: unknown,
): Promise<void> {
  const name = normalizeTelegramUsername(username);
  await exec.query(
    "update profile set telegram_username=$2 where telegram_user_id=$1 and archived_at is null and (telegram_username is distinct from $2)",
    [telegramId, name],
  );
  await exec.query(
    `update registration set telegram_username=$2 where telegram_user_id=$1
      and superseded_by is null and state in ${ACTIVE_REGISTRATION_STATES}
      and (telegram_username is distinct from $2)`,
    [telegramId, name],
  );
}
