import { describe, it, expect, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { dashboardTasksAnalytics, dashboardTasksWorkload } from "./tasks.ts";
const actor = { person: { id: "p", isTest: true, status: "active" }, assignments: [{ role: "administrator", scopeBuildingIds: ["b"] }] } as Actor;
describe("dashboard task analytics", () => {
  it("denies task aggregates to executor before reading data", async () => {
    const query = vi.fn();
    await expect(dashboardTasksAnalytics({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor, "month")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("applies test mode and building scope in SQL before aggregation", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardTasksAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "year");
    const [sql, params] = query.mock.calls[0]!;
    expect(params.slice(0, 3)).toEqual([true, false, ["b"]]);
    expect(sql).toContain("t.is_test=$1");
    expect(sql).toContain("r.building_id=any($3::uuid[])");
    expect(sql).toContain("w.building_ids <@ $3::uuid[]");
    expect(sql).toContain("l.to_state='accepted_admin'");
    expect(sql).not.toContain("t.title");
    expect(sql).not.toContain("t.instruction");
    expect(JSON.parse(params[5])).toHaveLength(12);
    expect(params[6]).toContain("canceled");
  });
  it("returns empty buckets and states when the database has nothing", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const result = await dashboardTasksAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "week");
    expect(result.buckets).toEqual([]); expect(result.states).toEqual([]);
  });
});

describe("dashboard tasks workload", () => {
  it("denies workload to executor before reading data", async () => {
    const query = vi.fn();
    await expect(dashboardTasksWorkload({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("counts open tasks only, overdue when due date passed", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardTasksWorkload({ db: { query } } as unknown as RegistryDeps, actor);
    const [sql, params] = query.mock.calls[0]!;
    expect(params.slice(0, 3)).toEqual([true, false, ["b"]]);
    expect(sql).toContain("t.state not in ('accepted_admin','canceled')");
    expect(sql).toContain("v.due_at<now()");
    expect(sql).not.toContain("t.title");
    expect(sql).not.toContain("t.instruction");
  });
  it("returns empty workload when there are no open tasks", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const result = await dashboardTasksWorkload({ db: { query } } as unknown as RegistryDeps, actor);
    expect(result.workload).toEqual([]);
  });
});
