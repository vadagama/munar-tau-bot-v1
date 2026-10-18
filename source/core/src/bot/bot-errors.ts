import { message } from "../templates/message.ts";
import { type TemplateStore } from "../templates/store.ts";
/**
 * Тексты ошибок для жителя/исполнителя: сухие коды API и технические
 * формулировки заменяются понятным текстом с намёком на следующий шаг.
 * Кастомные сообщения сценариев (например «Укажите номер обращения»)
 * показываются как есть — они уже написаны для пользователя.
 * Срез UX B: один язык по профилю вместо сдвоенных текстов.
 */
import { ApiError, ERROR_MESSAGES } from "../errors/api.ts";
import { type Lang } from "./text.ts";

/** Только для уже отрендеренных шаблонов: значения экранированы движком. */
export class BotTemplateError extends ApiError {}

/** Текст ответа бота на ошибку сценария. */
export function botErrorText(
  error: unknown,
  lang: Lang = "ru",
  store?: TemplateStore,
): string {
  if (!(error instanceof ApiError)) {
    return message(store, lang, "messages.errors.INTERNAL");
  }
  if (error instanceof BotTemplateError) return error.message;
  if (error.message === ERROR_MESSAGES[error.code]) {
    return message(store, lang, `messages.errors.${error.code}`);
  }
  return message(store, lang, "messages.errors.custom", {
    detail: error.message,
  });
}
