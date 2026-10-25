import { describe, expect, it } from "vitest";
import { analyticsLink, moveWidget, parseDashboardPreferences } from "./dashboard";
describe("personal dashboard settings", () => {
  it("recovers corrupt settings and rejects unknown widgets and limits", () => {
    expect(parseDashboardPreferences("bad").hidden).toEqual([]);
    const p = parseDashboardPreferences(JSON.stringify({ order: ["tasks", "tasks", "secret"], hidden: ["secret", "new"], limits: { tasks: 20, new: 999 } }));
    expect(p.order[0]).toBe("tasks"); expect(p.order).not.toContain("secret");
    expect(p.hidden).toEqual(["new"]); expect(p.limits).toEqual({ tasks: 20 });
  });
  it("moves both forward and backwards without mutating input", () => {
    const order = ["new", "tasks", "flow"];
    expect(moveWidget(order, "new", "tasks")).toEqual(["tasks", "new", "flow"]);
    expect(moveWidget(order, "flow", "new")).toEqual(["flow", "new", "tasks"]);
    expect(order).toEqual(["new", "tasks", "flow"]);
  });
  it("preserves exclusive range and event in the drill-down", () => {
    const url = new URL(analyticsLink("year", "2026-10-01T00:00:00+05:00", "2027-01-01T00:00:00+05:00", "closed"), "http://local");
    expect(url.searchParams.get("measure")).toBe("closed");
    expect(url.searchParams.get("until")).toBe("2027-01-01T00:00:00+05:00");
  });
});
