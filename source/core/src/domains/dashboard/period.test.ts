import { describe, expect, it } from "vitest";
import { dashboardPeriod } from "./period";
describe("dashboard calendar in Almaty", () => {
  it("uses local date across the UTC boundary", () => {
    const p = dashboardPeriod("day", new Date("2026-10-24T22:00:00Z"));
    expect(p.from).toBe("2026-10-25T00:00:00+05:00");
    expect(p.to).toBe("2026-10-26T00:00:00+05:00");
    expect(p.buckets).toHaveLength(4);
  });
  it("starts weeks on Monday and handles the year boundary", () => {
    expect(dashboardPeriod("week", new Date("2026-01-01T12:00:00Z")).from)
      .toBe("2025-12-29T00:00:00+05:00");
    expect(dashboardPeriod("year", new Date("2026-10-25T12:00:00Z")).buckets).toHaveLength(12);
  });
  it("rejects unknown periods", () => {
    expect(() => dashboardPeriod("forever")).toThrow();
  });
});
