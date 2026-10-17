/**
 * Помощники подачи текста бота (срез UX A): HTML-экранирование, даты,
 * ссылки на элементы списков. Бизнес-правила здесь не принимаются.
 *
 * Все ответы бота отправляются Telegram с parse_mode=HTML (функция jobs),
 * поэтому любой пользовательский/импортный текст в ответе обязан проходить
 * через esc(); теги добавляет только наш код.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Экранирование пользовательского текста для parse_mode=HTML. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Моноширинная команда в подсказке. */
export function cmd(command: string): string {
  return `<code>${esc(command)}</code>`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Дата/время в часовом поясе Алматы (UTC+5, перехода на летнее время нет).
 * Детерминированный числовой формат — одинаков в Node и Deno без ICU.
 */
export function fmtDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return esc(String(value));
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return `${pad2(shifted.getUTCDate())}.${pad2(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()} ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}

/** Интервал визита/согласования: «17.10.2026 14:00 – 17.10.2026 16:00». */
export function fmtInterval(start: unknown, end: unknown): string {
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

/**
 * Ссылка на элемент списка: номер строки (с 1), полный UUID или уникальный
 * префикс UUID. Списки передаются группами — резолвится объединение в
 * порядке групп. Возвращает id или null, если ссылку понять не удалось.
 */
export function resolveRef(
  token: string | undefined,
  groups: ReadonlyArray<readonly unknown[] | undefined>,
): string | null {
  const t = (token ?? "").trim();
  if (!t) return null;
  const union = groups
    .flatMap((g) => g ?? [])
    .filter((v): v is string => typeof v === "string");
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= union.length ? union[n - 1]! : null;
  }
  if (UUID_RE.test(t)) return t;
  if (/^[0-9a-f]{8}$/i.test(t)) {
    const hits = union.filter((id) =>
      id.toLowerCase().startsWith(t.toLowerCase())
    );
    return hits.length === 1 ? hits[0]! : null;
  }
  return null;
}

/** Нумерованный список строк: «1. …», «2. …». */
export function numbered(lines: readonly string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
}

/** Язык подачи бота (срез UX B): один язык вместо сдвоенных «ru / kk». */
export type Lang = "ru" | "kk";

/** Язык профиля: неизвестное значение — русский. */
export function langOf(language: unknown): Lang {
  return language === "kk" ? "kk" : "ru";
}

/** Одна реплика на языке пользователя; до выбора языка — русский. */
export function pick(lang: Lang, ru: string, kk: string): string {
  return lang === "kk" ? kk : ru;
}
