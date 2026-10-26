import { describe, it, expect, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { dashboardIncidentsAnalytics } from "./incidents.ts";
const actor = { person: { id: "p", isTest: true, status: "active" }, assignments: [{ role: "administrator", scopeBuildingIds: ["b"] }] } as Actor;
describe("dashboard incidents analytics", () => {
  it("denies incident aggregates to executor before reading data", async () => {
    const query = vi.fn();
    await expect(dashboardIncidentsAnalytics({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor, "month")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("keeps only incidents with active scope inside the actor area", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardIncidentsAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "year");
    const [sql, params] = query.mock.calls[0]!;
    expect(params.slice(0, 3)).toEqual([true, false, ["b"]]);
    expect(sql).toContain("exists(select 1 from incident_scope s where s.incident_id=i.id and s.active)");
    expect(sql).toContain("not (s.building_id=any($3::uuid[]))");
    expect(sql).toContain("i.created_at >= $4::timestamptz");
    expect(sql).toContain("i.completed_at >= $4::timestamptz");
    expect(sql).not.toContain("i.title");
    expect(JSON.parse(params[5] as string)).toHaveLength(12);
  });
  it("returns empty buckets when the database has nothing", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const result = await dashboardIncidentsAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "week");
    expect(result.buckets).toEqual([]);
  });
});
