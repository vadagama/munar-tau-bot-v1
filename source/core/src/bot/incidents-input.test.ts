import { expect, it, vi } from "vitest";
import { incidentStep } from "./incidents.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbExecutor } from "../db/client.ts";
const signal = vi.hoisted(() => vi.fn());
vi.mock(
  "../domains/incidents/duty.ts",
  async (original) => ({
    ...await original<typeof import("../domains/incidents/duty.ts")>(),
    signalEmergency: signal,
  }),
);
vi.mock(
  "../domains/incidents/service.ts",
  () => ({ listIncidents: async () => [] }),
);
vi.mock('../domains/tasks/service.ts',()=>({getTask:async()=>({id:'id'})}));
const actor = {
  profile: { id: "profile", language: "ru" },
  person: { id: "p", isTest: true },
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
    if (
      sql.startsWith("select id from task") ||
      sql.startsWith("select id from building")
    ) return [{ id: "id" }] as T[];
    return [];
  };
  return { deps: { db: { query } } as RegistryDeps, state: () => state };
}
it("opening the incident list invalidates the pending emergency signal", async () => {
  signal.mockClear();
  signal.mockResolvedValue({ contact: { on_duty: false, phone: null } });
  const h = harness();
  await incidentStep(h.deps, "1", "/danger З-1", actor);
  await incidentStep(h.deps, "1", "1", actor);
  const preview = await incidentStep(h.deps, "1", "Задымление", actor);
  const confirm = typeof preview === "string"
    ? ""
    : preview.buttons![0]![0]!.data;
  await incidentStep(h.deps, "1", "/incidents", actor);
  await expect(incidentStep(h.deps, "1", confirm, actor)).rejects.toMatchObject(
    { code: "VALIDATION_FAILED" },
  );
  expect(signal).not.toHaveBeenCalled();
});
