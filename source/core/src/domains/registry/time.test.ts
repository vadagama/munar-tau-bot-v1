import { expect, it } from "vitest";
import { addRuleHours } from "./time.ts";
it("REG-14: 12 рабочих часов с 15:00 заканчиваются на следующий день в 15:00", () => {
  expect(
    addRuleHours(new Date("2026-10-16T10:00:00Z"), {
      hours: 12,
      clock: "working",
      start: 8,
      end: 20,
    }).toISOString(),
  ).toBe("2026-10-17T10:00:00.000Z");
});
it("вне графика отсчёт начинается в 08:00 Алматы", () => {
  expect(
    addRuleHours(new Date("2026-10-16T18:00:00Z"), {
      hours: 12,
      clock: "working",
      start: 8,
      end: 20,
    }).toISOString(),
  ).toBe("2026-10-17T15:00:00.000Z");
});
it("72 часа приглашения включают ночь", () => {
  expect(
    addRuleHours(new Date("2026-10-16T18:00:00Z"), {
      hours: 72,
      clock: "calendar",
    }).toISOString(),
  ).toBe("2026-10-19T18:00:00.000Z");
});
