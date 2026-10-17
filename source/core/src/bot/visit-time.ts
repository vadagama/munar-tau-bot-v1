/**
 * Разбор «когда» для визита (срез UX C — ввод дат визитов): человеческий
 * ввод «завтра 10:00-12:00», «сегодня 18:00», «18.10 10:00-12:00» вместо
 * ISO-строк. Алматы = UTC+5 круглый год (перехода на летнее время нет),
 * поэтому календарь считается смещением без ICU — детерминированно в Node
 * и Deno. Прежний ввод пары ISO-дат с часовым поясом сценарий принимает
 * как раньше (совместимость с интеграционными тестами).
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Слово дня → смещение в сутках (ru и kk). */
const DAY_OFFSET: Record<string, number> = {
  "сегодня": 0,
  "бүгін": 0,
  "завтра": 1,
  "ертең": 1,
  "послезавтра": 2,
  "арғы": 2,
  "аргы": 2,
};

/** Визит без конца диапазона — двухчасовое окно (житель подтверждает сам). */
const DEFAULT_HOURS = 2;

export interface VisitInterval {
  start: string;
  end: string;
}

/** Календарь Алматы «сейчас»: UTC-время со сдвигом +5 ч. */
function almaty(now: Date): Date {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000);
}

/** День Алматы со смещением в сутках: «2026-10-18» (кнопки «сегодня/завтра»). */
export function almatyDay(offset: number, now = new Date()): string {
  const a = almaty(now);
  const d = new Date(
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + offset),
  );
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Смещение дня по одному слову; не день — null. */
export function dayOffset(word: string): number | null {
  return DAY_OFFSET[word.trim().toLowerCase()] ?? null;
}

/** Ввод целиком — только слово дня («завтра», «арғы күні»): шаг диалога. */
export function bareDayOffset(text: string): number | null {
  const t = text.trim().toLowerCase();
  const direct = dayOffset(t);
  if (direct !== null) return direct;
  const [first, second] = t.split(/\s+/);
  return (first === "арғы" || first === "аргы") &&
      (second === "күні" || second === "куни")
    ? 2
    : null;
}

function timeParts(token: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(token.trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh <= 23 && mm <= 59 ? { hh, mm } : null;
}

/** Интервал на конкретный день Алматы: «10:00-12:00» или «10:00» (+2 ч). */
export function visitFromDayTime(day: string, time: string): VisitInterval | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!d) return null;
  const y = Number(d[1]), m = Number(d[2]), dd = Number(d[3]);
  const times = time.trim().split(/\s*-\s*/);
  const start = timeParts(times[0] ?? "");
  if (!start) return null;
  const base = Date.UTC(y, m - 1, dd, start.hh, start.mm);
  const from = new Date(base);
  // 31.02 и 32.13 «перекатываются» на соседний месяц — отсекаем.
  if (
    from.getUTCFullYear() !== y || from.getUTCMonth() + 1 !== m ||
    from.getUTCDate() !== dd
  ) return null;
  const end = times[1] ? timeParts(times[1]) : null;
  if (times[1] && !end) return null;
  const to = new Date(
    end ? Date.UTC(y, m - 1, dd, end.hh, end.mm) : base + DEFAULT_HOURS * 3_600_000,
  );
  const iso = (x: Date) =>
    `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}T${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}:00+05:00`;
  return { start: iso(from), end: iso(to) };
}

/**
 * «Когда» целиком: день словом («завтра», «арғы күні») или датой
 * («18.10», «18.10.2026», «2026-10-18») плюс время «ЧЧ:ММ[-ЧЧ:ММ]».
 * Не распознано — null (сценарий покажет подсказку).
 */
export function parseVisitWhen(raw: string, now = new Date()): VisitInterval | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  const tokens = text.split(" ");
  let day: string | null = null;
  const offset = dayOffset(tokens[0] ?? "");
  if (offset !== null) {
    // «арғы күні» — два слова; остальные дни — одно.
    const used = offset === 2 && ["күні", "куни"].includes(tokens[1] ?? "")
      ? 2
      : 1;
    tokens.splice(0, used);
    day = almatyDay(offset, now);
  }
  if (day === null && tokens.length) {
    const t = tokens[0]!;
    const dot = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(t);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (dot) {
      const year = dot[3] ? Number(dot[3]) : almaty(now).getUTCFullYear();
      day = `${year}-${pad2(Number(dot[2]))}-${pad2(Number(dot[1]))}`;
      tokens.splice(0, 1);
    } else if (iso) {
      day = `${Number(iso[1])}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
      tokens.splice(0, 1);
    }
  }
  if (day === null) return null;
  return visitFromDayTime(day, tokens.join(" "));
}
