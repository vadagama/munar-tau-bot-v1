import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { visitFlow } from "./visits.ts";
const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  getRequest: vi.fn(),
  list: vi.fn(),
  propose: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../domains/tasks/service.ts", () => ({ getTask: mocks.getTask }));
vi.mock(
  "../domains/requests/service.ts",
  () => ({ getRequest: mocks.getRequest }),
);
vi.mock(
  "../domains/tasks/visits.ts",
  () => ({
    listRequestVisits: mocks.list,
    proposeVisit: mocks.propose,
    updateVisit: mocks.update,
  }),
);
const actor = { profile: { language: "ru" }, person: { id: "p" } } as Actor;
const deps = {
  db: { query: async () => [{ id: "t" }] },
} as unknown as RegistryDeps;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTask.mockResolvedValue({
    id: "t",
    number: "З-1",
    version: 3,
    can_execute: true,
    visits: [{
      id: "v",
      version: 7,
      status: "confirmed",
      interval_start: "2099-01-01T10:00:00Z",
      interval_end: "2099-01-01T12:00:00Z",
    }],
  });
});
it("keeps worker visit actions in buttons and binds them to the current screen", async () => {
  const state: Row = {};
  const reply = await visitFlow(deps, actor, state, "/taskvisits З-1", true);
  expect(reply && typeof reply !== "string" && reply.text).not.toContain(
    "/visit",
  );
  const button = reply && typeof reply !== "string"
    ? reply.buttons?.flat().find((b) => b.data.endsWith("no_access"))
    : undefined;
  expect(button).toBeDefined();
  await visitFlow(deps, actor, state, "/taskvisits З-1", true);
  await expect(visitFlow(deps, actor, state, button!.data, true)).rejects
    .toMatchObject({ code: "VALIDATION_FAILED" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("proposes a visit only after the complete date/note preview is confirmed", async () => {
  const state: Row = {};
  await visitFlow(deps, actor, state, "/proposevisit З-1", true);
  await visitFlow(deps, actor, state, "01.01.2099 10:00-12:00", true);
  const preview = await visitFlow(
    deps,
    actor,
    state,
    "Проверить <счётчик>",
    true,
  );
  expect(mocks.propose).not.toHaveBeenCalled();
  expect(preview && typeof preview !== "string" && preview.text).toContain(
    "&lt;счётчик&gt;",
  );
  const confirm = preview && typeof preview !== "string"
    ? preview.buttons?.[0]?.[0]?.data
    : "";
  await visitFlow(deps, actor, state, confirm!, true);
  expect(mocks.propose).toHaveBeenCalledWith(
    deps,
    actor,
    expect.objectContaining({
      task_id: "t",
      expected_version: 3,
      interval_start: "2099-01-01T10:00:00+05:00",
      interval_end: "2099-01-01T12:00:00+05:00",
      note: "Проверить <счётчик>",
    }),
    expect.any(String),
  );
});
it("does not revive a visit form after opening another card", async () => {
  const state: Row = {};
  await visitFlow(deps, actor, state, "/proposevisit З-1", true);
  const token = (state.visit_form as Row).token;
  await visitFlow(deps, actor, state, "/task З-2", true);
  await expect(visitFlow(deps, actor, state, `/visitconfirm ${token}`, true))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(mocks.propose).not.toHaveBeenCalled();
});
