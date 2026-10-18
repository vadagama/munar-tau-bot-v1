import { esc } from "../bot/text.ts";
const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
/** Значения — только текст; шаблон никогда не исполняет выражения. */
export function renderTemplate(
  text: string,
  vars: Readonly<Record<string, unknown>> = {},
): string {
  return text.replace(
    TOKEN,
    (token, name: string) =>
      Object.hasOwn(vars, name) ? esc(vars[name]) : token,
  );
}
/** Ограниченный HTML Telegram; атрибуты не являются контекстом текстовой подстановки. */
export function validateTemplate(
  text: string,
  variables: readonly string[],
): string[] {
  const errors: string[] = [];
  if (!text.trim()) errors.push("Текст обязателен");
  if (text.length > 4000) errors.push("Допустимо не более 4000 символов");
  for (const match of text.matchAll(TOKEN)) {
    if (!variables.includes(match[1]!)) {
      errors.push(`Неизвестная переменная: ${match[1]}`);
    }
  }
  const stack: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/<[^>]*>/g)) {
    if (text.slice(cursor, match.index).includes("<")) {
      errors.push("Некорректный HTML");
    }
    cursor = match.index! + match[0].length;
    const tag = /^<(\/)?(b|i|u|s|code|pre|a|tg-spoiler|blockquote)([^>]*)>$/
      .exec(match[0]);
    if (!tag) {
      errors.push("Запрещённый тег");
      continue;
    }
    const [, closing, name, attrs] = tag;
    if (closing) {
      if (attrs?.trim() || stack.pop() !== name) {
        errors.push("Нарушен баланс тегов");
      }
    } else {
      if (name === "a") {
        const href = /^\s+href=(?:"([^"<>]*)"|'([^'<>]*)')\s*$/.exec(attrs!);
        const value = href?.[1] ?? href?.[2] ?? "";
        if (
          !/^(https?:\/\/|tg:\/\/)[^\s{}]+$/.test(value) ||
          /&(?:#|colon)/i.test(value)
        ) {
          errors.push(
            "Ссылка должна содержать постоянный адрес http(s):// или tg://",
          );
        }
      } else if (attrs?.trim()) errors.push("Атрибуты тега запрещены");
      stack.push(name!);
    }
  }
  if (text.slice(cursor).includes("<")) errors.push("Некорректный HTML");
  if (stack.length) errors.push("Незакрытый тег");
  return [...new Set(errors)];
}
