import { describe, it, expect, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { dashboardQualityAnalytics } from "./quality.ts";
const actor = { person: { id: "p", isTest: true, status: "active" }, assignments: [{ role: "administrator", scopeBuildingIds: ["b"] }] } as Actor;
describe("dashboard quality analytics", () => {
  it("denies quality aggregates to executor before reading data", async () => {
    const query = vi.fn();
    await expect(dashboardQualityAnalytics({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor, "month")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("reuses manager scope for requests and ratings, period after manager params", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardQualityAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "year");
    const [sql, params] = query.mock.calls[0]!;
    expect(params.slice(0, 5)).toEqual([true, "p", false, false, ["b"]]);
    expect(sql.match(/r\.is_test=\$1/g)).toHaveLength(2);
    expect(sql).toContain("closed_at >= $6::timestamptz");
    expect(sql).toContain("l.to_state='accepted_admin'");
    expect(sql).toContain("g.withdrawn_at is null");
    expect(sql).toContain("percentile_cont(0.5)");
    expect(sql).not.toContain("r.description");
    expect(JSON.parse(params[7] as string)).toHaveLength(12);
  });
  it("returns empty buckets when the database has nothing", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const result = await dashboardQualityAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "week");
    expect(result.buckets).toEqual([]);
  });
});
