import dayjs from "dayjs";
import { expect, it } from "vitest";
import { financialPlacementValues } from "./financial-placement-values";
it("считает введённое время временем Алматы, независимо от часового пояса браузера", () => {
  expect(financialPlacementValues({ placed_at: dayjs("2026-10-01T10:30:00"), channel: "Стенд", evidence: "Проверено", reason: "Размещение", financial_version_id: "v2" }, 4)).toEqual({ placed_at: "2026-10-01T05:30:00.000Z", channel: "Стенд", evidence: "Проверено", reason: "Размещение", financial_version_id: "v2", expected_version: 4 });
});
it("не принимает отсутствие даты за текущее время", () => {
  expect(() => financialPlacementValues({ placed_at: null }, 4)).toThrow("Укажите дату размещения");
});
