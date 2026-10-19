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

/**
 * Команда в тексте подсказки. Без <code>: Telegram сам распознаёт /команды
 * в исходящих сообщениях (сущность bot_command) и делает их кликабельными —
 * по кодовому блоку распознавание не работает.
 */
export function cmd(command: string): string {
  return esc(command);
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

/** Дата без времени: «17.10.2026» (списки обращений, методички). */
export function fmtDay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return esc(String(value));
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return `${pad2(shifted.getUTCDate())}.${pad2(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()}`;
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

/**
 * Нормализация кода дома для ввода текстом (REG-11): регистр, «/», «-» и
 * пробелы приводятся к одному виду — «107-2», «107 2», «107/2» совпадают.
 */
export function normalizeBuildingCode(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[\s\-–—]+/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** Совпадение кода дома с пользовательским вводом: со слешем, без разделителей и со словом «дом». */
export function buildingCodeMatches(code: unknown, input: string): boolean {
  const house = /^(дом|үй)[\/\s]*/;
  const a = normalizeBuildingCode(String(code ?? "")).replace(house, "");
  const b = normalizeBuildingCode(input).replace(house, "");
  if (!a || !b) return false;
  return a === b || a.replaceAll("/", "") === b.replaceAll("/", "");
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
