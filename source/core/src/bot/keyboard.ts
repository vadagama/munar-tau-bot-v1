/**
 * Кнопки ответов бота (срез UX B). Паритет с текстом обязателен: callback_data
 * inline-кнопки — это точная текстовая команда, которую пользователь мог бы
 * набрать сам («/confirm З-26-1 2», номер строки списка «2»), поэтому любая
 * кнопка имеет текстовый эквивалент, а сценарии обрабатывают её тем же кодом.
 * Reply-клавиатура главных действий отправляет тексты команд как обычное
 * сообщение. Эмуляция сохраняет текст и кнопки общего сценария.
 */
import { ApiError } from "../errors/api.ts";

/** Кнопка inline-клавиатуры. */
export interface InlineButton {
  /** Подпись на кнопке (пользовательские данные — экранировать esc()). */
  text: string;
  /** Текстовая команда — эквивалент нажатия (Telegram: до 64 байт). */
  data: string;
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
    /** Постоянное меню для симулятора; Telegram формирует его отдельно. */
    menu?: (InlineButton & { scenario: string })[][];
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

/** Разметка inline-клавиатуры для Telegram sendMessage. */
export function inlineMarkup(buttons: InlineButton[][]): unknown {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data }))
    ),
  };
}

/**
 * Разметка reply-клавиатуры главных действий: кнопки отправляют текст
 * команды, клавиатура постоянная и подстраивается по высоте.
 */
export function menuMarkup(rows: readonly string[][]): unknown {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    is_persistent: true,
    resize_keyboard: true,
  };
}
