import type { LocalizedNotice } from "../../locales/notifications.ts";
import { enqueueNotice, type NoticeOptions } from "../notifications/service.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { BotKind } from "../../bot/bots.ts";
import { langOf, pick } from "../../bot/text.ts";
import {
  type BotReply,
  type InlineButton,
  inlineMarkup,
  menuMarkup,
  replyText,
} from "../../bot/keyboard.ts";

import { notificationParts } from "../notifications/text.ts";
export { notificationParts } from "../notifications/text.ts";

/** Клавиатуры ответа: inline-кнопки и/или reply-меню главных действий. */
export interface ReplyMarkup {
  buttons?: InlineButton[][];
  menu?: string[][];
}

/**
 * Разметка ответа для Telegram: inline-кнопки сценария и/или постоянное меню.
 * Одновременно заданы обе — сохраняется inline (меню постоянное, ставится
 * ближайшей репликой справки).
 */
export function telegramReplyMarkup(
  reply: BotReply,
  menu?: string[][],
): unknown | undefined {
  const buttons = typeof reply === "string" ? undefined : reply.buttons;
  if (buttons?.length) return inlineMarkup(buttons);
  if (menu?.length) return menuMarkup(menu);
  return undefined;
}

export async function notifyPerson(exec: DbExecutor, personId: string, message: string | LocalizedNotice, key: string, options: NoticeOptions = {}): Promise<void> {
  await enqueueNotice(exec,{personId,text:message,key,...options});
}
/**
 * Синхронный ответ в чат webhook'а. Текст — реплика сценария либо {ru, kk}:
 * для локализованного уведомления язык берётся из профиля получателя.
 */
export async function notifyTelegram(
  exec: DbExecutor,
  telegramId: unknown,
  message: BotReply | LocalizedNotice,
  key: string,
  bot: BotKind = "resident",
  menu?: string[][],
): Promise<void> {
  if (!telegramId) return;
  let reply: BotReply = message as BotReply;
  if (
    message && typeof message === "object" && "ru" in message && "kk" in message
  ) {
    const loc = message as LocalizedNotice;
    const [p] = await exec.query<{ language: string }>(
      "select language from profile where telegram_user_id=$1 and archived_at is null limit 1",
      [telegramId],
    );
    reply = pick(langOf(p?.language), loc.ru, loc.kk);
  }
  const text = replyText(reply);
  const markup = telegramReplyMarkup(reply, menu);
  const parts = notificationParts(text);
  for (const [index, part] of parts.entries()) {
    // Разметка уходит с последней частью: кнопки завершают сообщение.
    const partMarkup = index === parts.length - 1 ? markup : undefined;
    await exec.query(
      "insert into notification(telegram_user_id,text,dedup_key,channel,bot,reply_markup) values ($1,$2,$3,case when exists(select 1 from profile where telegram_user_id=$1 and is_test=true and archived_at is null) then 'simulator' else 'telegram' end,$4,$5::text::jsonb) on conflict(dedup_key) do nothing",
      [
        telegramId,
        part,
        index === 0 ? key : `${key}:part:${index + 1}`,
        bot,
        partMarkup === undefined ? null : JSON.stringify(partMarkup),
      ],
    );
  }
}
