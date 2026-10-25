/**
 * Кнопки ответов бота (срез UX B). Паритет с текстом обязателен: callback_data
 * inline-кнопки — это точная текстовая команда, которую пользователь мог бы
 * набрать сам («/confirm З-26-1 2», номер строки списка «2»), поэтому любая
 * кнопка имеет текстовый эквивалент, а сценарии обрабатывают её тем же кодом.
 * Эмуляция сохраняет текст и кнопки общего сценария.
 */
import { ApiError } from "../errors/api.ts";

/** Кнопка inline-клавиатуры. */
export interface InlineButton {
  /** Подпись на кнопке (пользовательские данные — экранировать esc()). */
  text: string;
  /**
   * Для обычной кнопки — текстовая команда-эквивалент нажатия (Telegram:
   * до 64 байт). Для копирующей (copy: true) — текст, который кладётся в
   * буфер обмена (например, deep link длиннее лимита callback_data).
   */
  data: string;
  /**
   * Копирующая кнопка (Bot API copy_text): нажатие копирует data в буфер
   * обмена и команды не отправляет. Единственное исключение из паритета
   * «кнопка = команда» — обычную команду так отправлять нельзя.
   */
  copy?: true;
}

/**
 * Ответ сценария бота. Строка — ответ без кнопок; объект — ответ с
 * inline-кнопками (рядами). Эмуляция передаёт текст и кнопки в кабинет.
 */
export type BotReply =
  | string
  | {
    text: string;
    /** Ряды inline-кнопок (по 1–3 кнопки в ряду). */
    buttons?: InlineButton[][];
  };

/** Текст ответа без клавиатур — для справки и текстовых транспортов. */
export function replyText(reply: BotReply): string {
  return typeof reply === "string" ? reply : reply.text;
}

/** Кнопка с текстовым эквивалентом; data длиннее 64 байт — ошибка программиста. */
export function btn(text: string, data: string): InlineButton {
  if (new TextEncoder().encode(data).length > 64) {
    throw new ApiError("INTERNAL", "callback_data длиннее 64 байт");
  }
  return { text, data };
}

/**
 * Копирующая кнопка (Bot API copy_text): нажатие кладёт textToCopy в буфер
 * обмена пользователя, ничего не отправляя боту. Лимит копируемого текста —
 * 1–256 символов (CopyTextButton.text), 64-байтный лимит callback_data сюда
 * не применяется — иначе deep link приглашения в кнопку не положить.
 */
export function copyBtn(text: string, textToCopy: string): InlineButton {
  if (textToCopy.length < 1 || textToCopy.length > 256) {
    throw new ApiError("INTERNAL", "copy_text длиннее 256 символов");
  }
  return { text, data: textToCopy, copy: true };
}

/** Разметка inline-клавиатуры для Telegram sendMessage. */
export function inlineMarkup(buttons: InlineButton[][]): unknown {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) =>
        b.copy
          ? { text: b.text, copy_text: { text: b.data } }
          : { text: b.text, callback_data: b.data }
      )
    ),
  };
}

/**
 * Разметка удаления reply-клавиатуры. Бот не использует reply-клавиатуры:
 * навигация — inline-кнопки и список команд Telegram. Константа прикрепляется
 * к сообщениям без своей разметки, чтобы убрать постоянное меню, оставшееся у
 * клиентов со старых версий; когда клавиатуры нет — no-op.
 */
export const REMOVE_KEYBOARD = { remove_keyboard: true } as const;
