import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import { listStaffRequests } from "./staff-queries.ts";
const manager = {
  assignments: [{ role: "administrator", scopeBuildingIds: ["b"] }],
  person: { id: "p", isTest: true, status: "active" },
} as Actor;
describe("staff queues", () => {
  it("denies executor before any query, including search and own requests", async () => {
    const query = vi.fn();
    await expect(
      listStaffRequests(
        { query },
        { ...manager, assignments: [{ role: "executor" }] } as Actor,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("returns ten plus a cursor without discarding rows in another queue", async () => {
    const query = vi.fn().mockResolvedValue(
      Array.from({ length: 11 }, (_, id) => ({ id })),
    );
    const page = await listStaffRequests({ query }, manager, { queue: "new" });
    expect(page.items).toHaveLength(10);
    expect(page.next_cursor).toBeTruthy();
    await expect(
      listStaffRequests({ query }, manager, {
        queue: "all",
        cursor: page.next_cursor,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("rejects invalid page sizes and offsets instead of silently truncating", async () => {
    const query = vi.fn();
    await expect(listStaffRequests({ query }, manager, { limit: 0 })).rejects
      .toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(listStaffRequests({ query }, manager, { cursor: "invalid" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
