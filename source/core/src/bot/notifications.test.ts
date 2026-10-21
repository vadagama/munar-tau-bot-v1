import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { notificationStep } from "./notifications.ts";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock(
  "../domains/notifications/service.ts",
  () => ({ getPreferences: mocks.get, setPreference: mocks.set }),
);
const actor = {
  profile: { id: "p", language: "ru" },
  person: { id: "n" },
} as Actor;
const deps = { db: { query: async () => [] } } as unknown as RegistryDeps;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    language: "ru",
    items: [{ event_type: "publication", mode: "digest" }],
  });
  mocks.set.mockResolvedValue({ language: "ru", items: [] });
});
it("selecting a category does not change preferences and offers allowed mode buttons", async () => {
  const reply = await notificationStep(
    deps,
    "1",
    "/notifications request.status",
    actor,
  );
  expect(mocks.set).not.toHaveBeenCalled();
  expect(typeof reply !== "string" && reply.buttons?.flat().map((b) => b.data))
    .toEqual([
      "/notifications request.status immediate",
      "/notifications request.status off",
      "/notifications",
    ]);
  expect(typeof reply !== "string" && reply.text).not.toContain(
    "/notifications",
  );
});
it("language selection preserves the existing publication mode", async () => {
  await notificationStep(deps, "1", "/notifications language kk", actor);
  expect(mocks.set).toHaveBeenCalledWith(
    deps,
    actor,
    "publication",
    "digest",
    "kk",
  );
});
