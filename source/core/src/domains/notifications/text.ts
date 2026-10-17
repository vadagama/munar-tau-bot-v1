/**
 * Разрез длинного сообщения на части для sendMessage (лимит 4096).
 * Граница не проходит внутри HTML-тега (<…>) и мнемоники (&…;) — иначе
 * Telegram отклонит разметку части. Нумерованные части сохраняют весь
 * текст, даже если доставка повторяется или меняет порядок.
 */
const HARD_LIMIT = 4096;
const PART_LIMIT = 4000;
/** Теги нашей разметки короткие; мнемоники — не длиннее нескольких символов. */
const LOOKBACK = 512;

/** Сдвигает границу назад, если она попала внутрь тега, мнемоники или суррогатной пары. */
function safeBoundary(message: string, start: number, end: number): number {
  const from = Math.max(start, end - LOOKBACK);
  const window = message.slice(from, end);
  const lt = window.lastIndexOf("<");
  const gt = window.lastIndexOf(">");
  if (lt > gt) return from + lt;
  const amp = window.lastIndexOf("&");
  if (amp > gt && amp !== -1) {
    const semi = window.indexOf(";", amp);
    if (semi === -1) return from + amp;
  }
  // Не разрываем UTF-16 суррогатную пару (emoji и другие символы за пределами BMP).
  const code = window.charCodeAt(window.length - 1);
  if (code >= 0xd800 && code <= 0xdbff) return end - 1;
  return end;
}

export function notificationParts(message: string): string[] {
  if (message.length <= HARD_LIMIT) return [message];
  const raw: string[] = [];
  let start = 0;
  while (start < message.length) {
    let end = Math.min(start + PART_LIMIT, message.length);
    if (end < message.length) end = safeBoundary(message, start, end);
    raw.push(message.slice(start, end));
    start = end;
  }
  return raw.map((text, index) => `[${index + 1}/${raw.length}]\n${text}`);
}
