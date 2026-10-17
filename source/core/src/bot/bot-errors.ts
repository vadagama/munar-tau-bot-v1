import { t, type TemplateStore } from "../templates/store.ts";
/**
 * Тексты ошибок для жителя/исполнителя: сухие коды API и технические
 * формулировки заменяются понятным текстом с намёком на следующий шаг.
 * Кастомные сообщения сценариев (например «Укажите номер обращения»)
 * показываются как есть — они уже написаны для пользователя.
 * Срез UX B: один язык по профилю вместо сдвоенных текстов.
 */
import { ApiError, ERROR_MESSAGES } from "../errors/api.ts";
import { esc, type Lang } from "./text.ts";

/** Только для уже отрендеренных шаблонов: значения экранированы движком. */
export class BotTemplateError extends ApiError {}

/** Текст ответа бота на ошибку сценария. */
export function botErrorText(error: unknown, lang: Lang = "ru", store?: TemplateStore): string {
  if (!(error instanceof ApiError)) return t(store,lang,"errors.INTERNAL");
  const isDefault = error.message === ERROR_MESSAGES[error.code];
  const main = isDefault
    ? t(store,lang,`errors.${error.code}`)
    : error instanceof BotTemplateError ? error.message : esc(error.message);
  return `${main}\n${t(store,lang,"common.error_help")}`;
}
