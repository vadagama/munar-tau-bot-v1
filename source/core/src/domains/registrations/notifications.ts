import type { DbExecutor } from "../../db/client.ts";

/** Нумерованные части сохраняют весь текст, даже если доставка повторяется или меняет порядок. */
export function notificationParts(message: string): string[] {
  if (message.length <= 4096) return [message];
  const parts: string[] = [];
  let part = "";
  for (const character of message) {
    if (part.length + character.length > 4000) {
      parts.push(part);
      part = "";
    }
    part += character;
  }
  if (part) parts.push(part);
  return parts.map((text, index) => `[${index + 1}/${parts.length}]\n${text}`);
}

export async function notifyPerson(
  exec: DbExecutor,
  personId: string,
  message: string,
  key: string,
): Promise<void> {
  for (const [index, part] of notificationParts(message).entries()) {
    await exec.query(
      `insert into notification(telegram_user_id,text,dedup_key,recipient_person_id,channel)
    select telegram_user_id,$2,$3,person_id,case when is_test then 'simulator' else 'telegram' end from profile where person_id=$1 and archived_at is null on conflict(dedup_key) do nothing`,
      [personId, part, index === 0 ? key : `${key}:part:${index + 1}`],
    );
  }
}
export async function notifyTelegram(
  exec: DbExecutor,
  telegramId: unknown,
  message: string,
  key: string,
): Promise<void> {
  if (!telegramId) return;
  for (const [index, part] of notificationParts(message).entries()) {
    await exec.query(
      "insert into notification(telegram_user_id,text,dedup_key,channel) values ($1,$2,$3,case when exists(select 1 from profile where telegram_user_id=$1 and is_test=true and archived_at is null) then 'simulator' else 'telegram' end) on conflict(dedup_key) do nothing",
      [telegramId, part, index === 0 ? key : `${key}:part:${index + 1}`],
    );
  }
}
