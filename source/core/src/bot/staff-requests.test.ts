import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbExecutor } from "../db/client.ts";
import { staffRequestStep } from "./staff-requests.ts";
const mocks = vi.hoisted(() => ({
  requireRequest: vi.fn(),
  listStaffRequests: vi.fn(),
  transitionRequest: vi.fn(),
  startRequestWork: vi.fn(),
}));
vi.mock(
  "../domains/requests/access.ts",
  () => ({ requireRequest: mocks.requireRequest }),
);
vi.mock(
  "../domains/requests/staff-queries.ts",
  async (original) => ({
    ...await original<typeof import("../domains/requests/staff-queries.ts")>(),
    listStaffRequests: mocks.listStaffRequests,
  }),
);
vi.mock(
  "../domains/requests/service.ts",
  async (original) => ({
    ...await original<typeof import("../domains/requests/service.ts")>(),
    transitionRequest: mocks.transitionRequest,
  }),
);
vi.mock(
  "../domains/tasks/start-request-work.ts",
  () => ({ startRequestWork: mocks.startRequestWork }),
);
const actor = {
  person: { id: "p", isTest: true, status: "active" },
  profile: { id: "profile", language: "ru" },
  assignments: [{ role: "administrator" }],
} as Actor;
function harness() {
  let state = {};
  const query: DbExecutor["query"] = async <T>(
    sql: string,
    p: readonly unknown[] = [],
  ) => {
    if (sql.startsWith("select state from bot_dialog")) {
      return [{ state }] as T[];
    }
    if (sql.startsWith("update bot_dialog")) state = JSON.parse(String(p[1]));
    if (sql.startsWith("select id from request")) return [{ id: "r" }] as T[];
    return [];
  };
  return {
    deps: {
      db: {
        query,
        transaction: (fn) => fn({ query }),
      },
      audit: {},
    } as RegistryDeps,
    state: () => state,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequest.mockResolvedValue({
    id: "r",
    number: "З-1",
    state: "new",
    version: 1,
    description: "<опасный текст>",
    kind: "question",
  });
  mocks.listStaffRequests.mockResolvedValue({ items: [], next_cursor: null });
});
describe("staff request UI", () => {
  it("denies ordinary executor before reading requests", async () => {
    const h = harness();
    await expect(
      staffRequestStep(
        h.deps,
        "1",
        "/staffrequests",
        { ...actor, assignments: [{ role: "executor" }] } as Actor,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.listStaffRequests).not.toHaveBeenCalled();
  });
  it("shows queues as buttons without commands in body", async () => {
    const h = harness();
    const reply = await staffRequestStep(h.deps, "1", "/staffrequests", actor);
    expect(reply.text).not.toContain("/");
    expect(reply.buttons?.flat().some((b) => b.text === "Без заданий")).toBe(
      true,
    );
  });
  it("escapes request data and does not show creation or arbitrary status changes", async () => {
    const h = harness();
    const reply = await staffRequestStep(
      h.deps,
      "1",
      "/staffrequest З-1",
      actor,
    );
    expect(reply.text).toContain("&lt;опасный текст&gt;");
    expect(reply.text).not.toContain("/staff");
    expect(
      reply.buttons?.flat().some((b) => b.text === "Взять на рассмотрение"),
    ).toBe(true);
    expect(JSON.stringify(reply.buttons)).not.toContain("/newrequest");
  });
  it("refuses a stale button without performing a transition", async () => {
    const h = harness();
    await staffRequestStep(h.deps, "1", "/staffrequest З-1", actor);
    await staffRequestStep(h.deps, "1", "/sr stale start_review", actor);
    expect(mocks.transitionRequest).not.toHaveBeenCalled();
  });
});
it("invalidates an abandoned confirmation after switching scenarios", async () => {
  const h = harness();
  let r = await staffRequestStep(h.deps, "1", "/staffrequest З-1", actor);
  r = await staffRequestStep(
    h.deps,
    "1",
    r.buttons.flat().find((b) => b.text === "Взять на рассмотрение")!.data,
    actor,
  );
  const confirm = r.buttons.flat().find((b) => b.text === "Подтвердить")!.data;
  (h.state() as Record<string, unknown>).scenario = "tasks";
  await staffRequestStep(h.deps, "1", confirm, actor);
  expect(mocks.transitionRequest).not.toHaveBeenCalled();
});
it("keeps the full request description accessible", async () => {
  const h = harness(), description = "Подробное описание ".repeat(180);
  mocks.requireRequest.mockResolvedValue({
    id: "r",
    number: "З-1",
    state: "new",
    version: 1,
    description,
    kind: "question",
  });
  expect((await staffRequestStep(h.deps, "1", "/staffrequest З-1", actor)).text)
    .toContain(description);
});

it("accepts the explicit no-premises choice and advances to location", async () => {
  const h = harness();
  await staffRequestStep(h.deps, "1", "/staffrequest З-1", actor);
  Object.assign(h.state(), {
    token: "choice",
    form: {
      action: "place",
      request_id: "r",
      fields: ["premises", "location_text", "reason"],
      step: 0,
      values: { building_id: "b" },
    },
    choice_ids: [],
  });
  const reply = await staffRequestStep(
    h.deps,
    "1",
    "/sr choice value 0",
    actor,
  );
  expect(
    (h.state() as { form: { step: number; values: { premises_id: unknown } } })
      .form.step,
  ).toBe(1);
  expect(reply.buttons.flat().some((b) => b.data.endsWith("value 0"))).toBe(
    false,
  );
});
