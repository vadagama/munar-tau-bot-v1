import { expect, it, vi } from "vitest";
import { markStaffRead, staffTimeline } from "./staff-timeline.ts";
import type { Actor } from "../../pdp/types.ts";
const { requireRequest } = vi.hoisted(() => ({
  requireRequest: vi.fn().mockResolvedValue({}),
}));
vi.mock("./access.ts", () => ({ requireRequest }));
const actor = {
  person: { id: "p", status: "active" },
  assignments: [{ role: "administrator" }],
} as Actor;
it("does not acknowledge unshown/inaccessible messages or skip another channel", async () => {
  const query = vi.fn().mockResolvedValue([]);
  await expect(
    markStaffRead({ query }, actor, "r", [
      "00000000-0000-4000-8000-000000000001",
    ]),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(query).toHaveBeenCalledTimes(1);
});
it("checks object authorization before loading any timeline", async () => {
  requireRequest.mockRejectedValueOnce(new Error("denied"));
  const query = vi.fn();
  await expect(staffTimeline({ query }, actor, "r", "messages")).rejects
    .toThrow("denied");
  expect(query).not.toHaveBeenCalled();
});
it("refuses arbitrary sections and negative offsets", async () => {
  const query = vi.fn();
  await expect(staffTimeline({ query }, actor, "r", "messages", -1)).rejects
    .toMatchObject({ code: "VALIDATION_FAILED" });
  expect(query).not.toHaveBeenCalled();
});
