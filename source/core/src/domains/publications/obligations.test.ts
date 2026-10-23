import { expect, it } from "vitest";
import { financialPeriodStart, missingFinancialPlacements } from "./obligation-policy.ts";

it("FIN-04: срок начинается после отчётного периода по времени Алматы", () => {
  expect(financialPeriodStart("2026-10-31").toISOString()).toBe("2026-10-31T19:00:00.000Z");
  expect(financialPeriodStart("2023-10-31").toISOString()).toBe("2023-10-31T18:00:00.000Z");
  expect(financialPeriodStart("2024-02-29").toISOString()).toBe("2024-02-29T19:00:00.000Z");
  expect(financialPeriodStart("2004-03-27").toISOString()).toBe("2004-03-27T18:00:00.000Z");
  expect(() => financialPeriodStart("2026-02-31")).toThrow();
});
it("FIN-04: только доказательства текущей версии закрывают каждый обязательный канал", () => {
  const required = ["bot", "noticeboard"];
  expect(missingFinancialPlacements(required, "v2", [])).toEqual(required);
  const rows = [{ financial_version_id: "v2", channel: "bot" }, { financial_version_id: "v1", channel: "noticeboard" }];
  expect(missingFinancialPlacements(required, "v2", rows)).toEqual(["noticeboard"]);
  expect(missingFinancialPlacements(required, "v2", [...rows, { financial_version_id: "v2", channel: "noticeboard" }])).toEqual([]);
});
