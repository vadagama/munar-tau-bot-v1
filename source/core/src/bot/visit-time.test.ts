/**
 * Модульные тесты разбора времени визита (срез UX C): человеческий ввод
 * «завтра 10:00-12:00» вместо ISO. «Сейчас» фиксировано — 2026-10-17 10:00 UTC,
 * в Алматы 17.10 15:00; ожидания детерминированы (UTC+5, без летнего времени).
 */
import { describe, expect, it } from "vitest";

import {
  almatyDay,
  bareDayOffset,
  parseVisitWhen,
  visitFromDayTime,
} from "./visit-time.ts";

const NOW = new Date("2026-10-17T10:00:00Z");

describe("almatyDay", () => {
  it("сегодня и завтра в Алматы", () => {
    expect(almatyDay(0, NOW)).toBe("2026-10-17");
    expect(almatyDay(1, NOW)).toBe("2026-10-18");
    // Суточный сдвиг около полуночи Алматы: 20:00 UTC 31.10 = 01:00 01.11 Алматы,
    // «завтра» относительно него — 02.11.
    expect(almatyDay(1, new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-02");
  });
});

describe("bareDayOffset", () => {
  it("слово дня без времени — шаг диалога", () => {
    expect(bareDayOffset("сегодня")).toBe(0);
    expect(bareDayOffset("Завтра")).toBe(1);
    expect(bareDayOffset("ертең")).toBe(1);
    expect(bareDayOffset("арғы күні")).toBe(2);
    expect(bareDayOffset("завтра 10:00")).toBeNull();
    expect(bareDayOffset("привет")).toBeNull();
  });
});

describe("parseVisitWhen", () => {
  it("«завтра 10:00-12:00» — интервал в Алматы", () => {
    expect(parseVisitWhen("завтра 10:00-12:00", NOW)).toEqual({
      start: "2026-10-18T10:00:00+05:00",
      end: "2026-10-18T12:00:00+05:00",
    });
  });

  it("время без диапазона — двухчасовое окно по умолчанию", () => {
    expect(parseVisitWhen("сегодня 18:00", NOW)).toEqual({
      start: "2026-10-17T18:00:00+05:00",
      end: "2026-10-17T20:00:00+05:00",
    });
    // Окно переходит через полночь Алматы.
    expect(parseVisitWhen("завтра 23:30", NOW)).toEqual({
      start: "2026-10-18T23:30:00+05:00",
      end: "2026-10-19T01:30:00+05:00",
    });
  });

  it("казахские слова дней", () => {
    expect(parseVisitWhen("ертең 10:00-12:00", NOW)).toEqual({
      start: "2026-10-18T10:00:00+05:00",
      end: "2026-10-18T12:00:00+05:00",
    });
    expect(parseVisitWhen("бүгін 09:00", NOW)?.start).toBe(
      "2026-10-17T09:00:00+05:00",
    );
    expect(parseVisitWhen("арғы күні 10:00", NOW)?.start).toBe(
      "2026-10-19T10:00:00+05:00",
    );
  });

  it("дата числом: дд.мм, дд.мм.гггг и гггг-мм-дд", () => {
    expect(parseVisitWhen("18.10 10:00-12:00", NOW)?.start).toBe(
      "2026-10-18T10:00:00+05:00",
    );
    expect(parseVisitWhen("18.10.2026 10:00-12:00", NOW)?.start).toBe(
      "2026-10-18T10:00:00+05:00",
    );
    expect(parseVisitWhen("2026-10-19 09:00", NOW)?.start).toBe(
      "2026-10-19T09:00:00+05:00",
    );
  });

  it("нераспознаваемый ввод — null", () => {
    expect(parseVisitWhen("", NOW)).toBeNull();
    expect(parseVisitWhen("позвоните", NOW)).toBeNull();
    expect(parseVisitWhen("завтра 25:00", NOW)).toBeNull();
    expect(parseVisitWhen("32.13 10:00", NOW)).toBeNull();
    expect(parseVisitWhen("18.10 10:00-25:00", NOW)).toBeNull();
    expect(parseVisitWhen("завтра в 10", NOW)).toBeNull();
  });
});

describe("visitFromDayTime (шаг диалога после кнопки дня)", () => {
  it("время на сохранённый день", () => {
    expect(visitFromDayTime("2026-10-18", "10:00-12:00")).toEqual({
      start: "2026-10-18T10:00:00+05:00",
      end: "2026-10-18T12:00:00+05:00",
    });
    expect(visitFromDayTime("2026-10-18", "10:00")?.end).toBe(
      "2026-10-18T12:00:00+05:00",
    );
  });

  it("несуществующий день отклоняется, а не «перекатывается»", () => {
    expect(visitFromDayTime("2026-02-30", "10:00")).toBeNull();
    expect(visitFromDayTime("мусор", "10:00")).toBeNull();
    expect(visitFromDayTime("2026-10-18", "мусор")).toBeNull();
  });
});
