/**
 * Разрез длинного сообщения на части для sendMessage (лимит 4096).
 * Граница не проходит внутри HTML-тега (<…>) и мнемоники (&…;) — иначе
 * Telegram отклонит разметку части. Нумерованные части сохраняют весь
 * текст, даже если доставка повторяется или меняет порядок.
 */
import { type Lang, pick } from "../../bot/text.ts";
import { btn, inlineMarkup } from "../../bot/keyboard.ts";

const HARD_LIMIT = 4096;
const PART_LIMIT = 4000;
interface HtmlToken {
  text: string;
  name?: string;
  closing?: boolean;
}
interface OpenTag {
  name: string;
  text: string;
}
const ENTITY = /^&(?:amp|lt|gt|quot|#\d{1,8}|#x[0-9a-fA-F]{1,6});$/;
const HTML_TAG =
  /^<(\/)?(b|i|u|s|code|pre|a|tg-spoiler|blockquote)(?=\s|>)([^>]*)>$/;
const closingTags = (tags: readonly OpenTag[]) =>
  [...tags].reverse().map((t) => `</${t.name}>`).join("");
const openingTags = (tags: readonly OpenTag[]) =>
  tags.map((t) => t.text).join("");

/** Token boundaries are complete tags/entities or Unicode code points. */
function tokensOf(message: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  for (
    const match of message.matchAll(
      /<[^<>]*>|&(?:amp|lt|gt|quot|#\d{1,8}|#x[0-9a-fA-F]{1,6});|./gsu,
    )
  ) {
    const text = match[0];
    const tag = HTML_TAG.exec(text);
    if (tag) tokens.push({ text, name: tag[2]!, closing: !!tag[1] });
    else if (ENTITY.test(text)) tokens.push({ text });
    else {for (const char of text) {
        tokens.push({
          text: char === "&"
            ? "&amp;"
            : char === "<"
            ? "&lt;"
            : char === ">"
            ? "&gt;"
            : char,
        });
      }}
  }
  return tokens;
}

export function notificationParts(message: string): string[] {
  if (message.length <= HARD_LIMIT) return [message];
  let tokens = tokensOf(message);
  // A huge URL or extreme nesting cannot be reopened inside a bounded part.
  // In that exceptional case keep all visible text and omit formatting tags.
  const check: OpenTag[] = [];
  let preserveMarkup = true;
  for (const token of tokens) {
    if (!token.name) continue;
    if (token.closing) {
      if (check.pop()?.name !== token.name) preserveMarkup = false;
    } else check.push({ name: token.name, text: token.text });
    if (
      openingTags(check).length + closingTags(check).length > PART_LIMIT / 2
    ) preserveMarkup = false;
  }
  if (check.length) preserveMarkup = false;
  if (!preserveMarkup) tokens = tokens.filter((token) => !token.name);

  const parts: string[] = [];
  const stack: OpenTag[] = [];
  let body = "";
  for (const token of tokens) {
    const next = [...stack];
    if (token.name) {
      if (token.closing) next.pop();
      else next.push({ name: token.name, text: token.text });
    }
    if (
      body.length + token.text.length + closingTags(next).length > PART_LIMIT
    ) {
      parts.push(body + closingTags(stack));
      body = openingTags(stack);
    }
    body += token.text;
    stack.splice(0, stack.length, ...next);
  }
  if (body || !parts.length) parts.push(body + closingTags(stack));
  return parts.length === 1
    ? parts
    : parts.map((text, index) => `[${index + 1}/${parts.length}]\n${text}`);
}

/**
 * Кнопка-точка входа в уведомлении (срез C): подпись «Открыть …», а
 * callback_data — точная команда открытия карточки, которую пользователь
 * мог бы набрать сам. Паритет с текстом по построению: webhook исполняет
 * callback как текстовый шаг, PDP и аудит общие. Уведомление доставляет
 * тот бот, кому оно адресовано (notification.bot, ADR-009), поэтому кнопка
 * работает у обоих ботов без различий.
 */
export function entryMarkup(
  kind: "request" | "task",
  number: string,
  lang: Lang,
  bot: "resident" | "worker" = "resident",
): unknown {
  const label = kind === "request"
    ? pick(lang, "Открыть обращение", "Өтінішті ашу")
    : pick(lang, "Открыть задание", "Тапсырманы ашу");
  return inlineMarkup([[
    btn(label, `${kind === "request" ? bot === "worker" ? "/staffrequest" : "/request" : "/task"} ${number}`),
  ]]);
}
