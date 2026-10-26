import { describe, it, expect, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { dashboardRegistrationsAnalytics } from "./registrations.ts";
const actor = { person: { id: "p", isTest: true, status: "active" }, assignments: [{ role: "administrator", scopeBuildingIds: ["b"] }] } as Actor;
describe("dashboard registrations analytics", () => {
  it("denies aggregates without registration.review before reading data", async () => {
    const query = vi.fn();
    await expect(dashboardRegistrationsAnalytics({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor, "month")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("counts approved decisions with listRegistrations scope", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardRegistrationsAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "year");
    const [sql, params] = query.mock.calls[0]!;
    expect(params[0]).toBe(true);
    expect(params[1]).toEqual(["b"]);
    expect(sql).toContain("r.superseded_by is null");
    expect(sql).toContain("r.state='approved'");
    expect(sql).toContain("decided_at >= $3::timestamptz");
    expect(sql).toContain("p.building_id=any($2::uuid[])");
    expect(sql).not.toContain("r.full_name");
    expect(JSON.parse(params[4] as string)).toHaveLength(12);
  });
  it("tech_admin reads approved registrations without building scope", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardRegistrationsAnalytics({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "tech_admin" }] } as Actor, "week");
    const [, params] = query.mock.calls[0]!;
    expect(params[1]).toBeNull();
  });
  it("returns empty buckets when the database has nothing", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const result = await dashboardRegistrationsAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "week");
    expect(result.buckets).toEqual([]);
  });
});
