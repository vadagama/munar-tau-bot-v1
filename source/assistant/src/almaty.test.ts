// Тесты границы суток «05:00 → 05:00» Asia/Almaty: 05:00 по Алматы — ровно
// полночь UTC (UTC+5 без DST), поэтому ассистентский день = номер суток UTC.

import { describe, expect, it } from "vitest";
import { assistantDay, assistantDoName, effectiveEpoch, parseAssistantDoName } from "./almaty.ts";

// 26.10.2026 06:00 UTC = 11:00 Алматы; 26.10.2026 19:59:59.999 UTC = 00:59:59.999 Алматы 27-го,
// граница ещё не пройдена; 27.10.2026 00:00 UTC = 05:00 Алматы 27-го — новый день.
const DAY_20687 = Math.floor(Date.parse("2026-10-26T00:00:00Z") / 86_400_000);

describe("assistantDay", () => {
  it("полдень и поздний вечер одного UTC-суток — один день", () => {
    expect(assistantDay(new Date("2026-10-26T06:00:00Z"))).toBe(DAY_20687);
    expect(assistantDay(new Date("2026-10-26T19:59:59.999Z"))).toBe(DAY_20687);
  });

  it("05:00 по Алматы = полночь UTC — новый день", () => {
    expect(assistantDay(new Date("2026-10-27T00:00:00Z"))).toBe(DAY_20687 + 1);
  });

  it("01:00 по Алматы (20:00 UTC предыдущих суток) — ещё предыдущий день", () => {
    expect(assistantDay(new Date("2026-10-26T20:00:00Z"))).toBe(DAY_20687);
  });
});

describe("effectiveEpoch", () => {
  it("обычный день: эффективная эпоха = сегодняшний день", () => {
    expect(effectiveEpoch(1, new Date("2026-10-26T06:00:00Z"))).toBe(DAY_20687);
  });

  it("после ручной очистки конфиг-эпоха выше дня — она и эффективна", () => {
    expect(effectiveEpoch(DAY_20687 + 5, new Date("2026-10-26T06:00:00Z"))).toBe(DAY_20687 + 5);
  });

  it("наступивший день 05:00 становится эпохой только когда догоняет конфиг-эпоху", () => {
    // Очистка поставила DAY+5; сутки DAY+1 ещё ниже — продолжает жить эпоха очистки.
    expect(effectiveEpoch(DAY_20687 + 5, new Date("2026-10-27T00:00:00Z"))).toBe(DAY_20687 + 5);
    // Обычная конфиг-эпоха (1) перекрывается наступившим днём.
    expect(effectiveEpoch(1, new Date("2026-10-27T00:00:00Z"))).toBe(DAY_20687 + 1);
  });
});

describe("имя DO", () => {
  it("собирается и разбирается симметрично", () => {
    const name = assistantDoName("profile-1", DAY_20687);
    expect(parseAssistantDoName(name)).toEqual({ profileId: "profile-1", epoch: DAY_20687 });
  });

  it("чужой формат имени — null", () => {
    expect(parseAssistantDoName("other:profile-1:1")).toBeNull();
    expect(parseAssistantDoName("assistant:profile-1")).toBeNull();
    expect(parseAssistantDoName("assistant:profile-1:abc")).toBeNull();
    expect(parseAssistantDoName("assistant::1")).toBeNull();
  });
});
