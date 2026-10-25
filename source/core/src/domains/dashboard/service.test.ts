import { describe, it, expect, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { dashboardRequests } from "./service.ts";
import { requestFilters } from "./requests.ts";
const actor = { person: { id: "p", isTest: true, status: "active" }, assignments: [{ role: "administrator", scopeBuildingIds: ["b"] }] } as Actor;
describe("dashboard authorization and drill-down", () => {
  it("denies request aggregates to executor before reading data", async () => {
    const query = vi.fn();
    await expect(dashboardRequests({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("applies test mode, complaint exclusions and building scope in SQL before aggregation", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await dashboardRequests({ db: { query } } as unknown as RegistryDeps, actor);
    const [sql, params] = query.mock.calls[0]!;
    expect(params.slice(0, 5)).toEqual([true, "p", false, false, ["b"]]);
    expect(sql).toContain("complaint_subject_person_id is distinct from $2");
    expect(sql).toContain("r.is_test=$1");
    expect(sql).toContain("r.building_id=any($5::uuid[])");
  });
  it("uses closed timestamp and exclusive end in SQL and preserves the total before pagination", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "r", dashboard_total: "132" }]);
    const page = await dashboardRequests({ db: { query } } as unknown as RegistryDeps, actor, { measure: "closed", kind: "question", from: "2026-10-25T00:00:00+05:00", to: "2026-10-26T00:00:00+05:00", limit: 20 });
    expect(query.mock.calls[0]![0]).toContain("r.closed_at<$7");
    expect(query.mock.calls[0]![0]).toContain("r.closed_at>=$6");
    expect(query.mock.calls[0]![1].slice(5, 8)).toEqual(["2026-10-25T00:00:00+05:00", "2026-10-26T00:00:00+05:00", "question"]);
    expect(page.total).toBe(132); expect(page.next_cursor).toBe("20");
    expect(page.items).toEqual([{ id: "r" }]);
  });
  it("rejects invalid ranges, measures, page sizes and kinds", () => {
    for (const input of [{ from: "bad" }, { measure: "anything" }, { kind: "anything" }, { limit: 0 }, { from: "2026-02-01", to: "2026-01-01" }]) expect(() => requestFilters(input)).toThrow();
  });
});

describe("dashboard aggregation", () => {
  it("passes JSON bucket data as text and never reads request descriptions for charts", async () => {
    const { dashboardAnalytics } = await import("./requests.ts");
    const query = vi.fn().mockResolvedValue([{ buckets: [], kinds: [] }]);
    await dashboardAnalytics({ db: { query } } as unknown as RegistryDeps, actor, "year");
    expect(query.mock.calls[0]![0]).toContain("$8::text::jsonb");
    expect(query.mock.calls[0]![0]).not.toContain("r.description");
    expect(JSON.parse(query.mock.calls[0]![1][7])).toHaveLength(12);
  });
  it("loads only active incidents in one statement and applies PDP before returning them", async () => {
    const { dashboardIncidents } = await import("./queues.ts");
    const incident = { id: "a", state: "mitigation", is_test: true, published: false, scope: [{ building_id: "b" }], member: false };
    const query = vi.fn().mockResolvedValue([incident, { ...incident, id: "outside", scope: [{ building_id: "other" }] }, { ...incident, id: "real", is_test: false }]);
    const result = await dashboardIncidents({ db: { query } } as unknown as RegistryDeps, actor);
    expect(result.map(r => r.id)).toEqual(["a"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain("'mitigation'");
    expect(query.mock.calls[0]![0]).toContain("i.state in");
  });
  it("does not fetch staff data or expose staff widgets for a resident", async () => {
    const { getDashboard } = await import("./service.ts");
    const query = vi.fn();
    const result = await getDashboard({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [], connections: [], emulation: null } as unknown as Actor);
    expect(result.widgets).toEqual([]); expect(result.analytics).toBe(false);
    expect(result.assistant.state).toBe("disabled");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("task queue PDP", () => {
  it("does not expose other executors' tasks or another data mode", async () => {
    const { dashboardTasks } = await import("./queues.ts");
    const row = { id: "mine", is_test: true, assignee_person_id: "p", building_ids: ["b"], state: "awaiting_acceptance" };
    const query = vi.fn().mockResolvedValue([row, { ...row, id: "other", assignee_person_id: "other" }, { ...row, id: "real", is_test: false }]);
    const result = await dashboardTasks({ db: { query } } as unknown as RegistryDeps, { ...actor, assignments: [{ role: "executor" }] } as Actor);
    expect(result.map(r => r.id)).toEqual(["mine"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain("t.state in");
  });
});
