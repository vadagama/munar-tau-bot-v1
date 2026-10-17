import type { LocalizedNotice } from "../../locales/notifications.ts";
import { enqueueNotice, type NoticeOptions } from "../notifications/service.ts";
import type { DbExecutor } from "../../db/client.ts";

import { notificationParts } from "../notifications/text.ts";
export { notificationParts } from "../notifications/text.ts";
export async function notifyPerson(exec: DbExecutor, personId: string, message: string | LocalizedNotice, key: string, options: NoticeOptions = {}): Promise<void> {
  await enqueueNotice(exec,{personId,text:message,key,...options});
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
