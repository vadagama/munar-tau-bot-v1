import { expect, it, vi } from "vitest";
import { applyTaskDocumentRules, type DocumentRule } from "./rules.ts";
import { createObligation } from "./obligations.ts";
import { requireTask } from "../tasks/access.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { makeTestActor } from "../../testing/actors.ts";
vi.mock("./obligations.ts", () => ({ createObligation: vi.fn(async () => ({})), obligationInput: vi.fn() }));
vi.mock("../tasks/access.ts", () => ({ requireTask: vi.fn() }));

it("A1 → B1 → A1 создаёт отдельные применения требований без коллизии ключей", async () => {
  const exec = { query: async <T>() => [] as T[] }, deps = { db: {} } as RegistryDeps;
  const rule = { kind: "act", phase: "before_acceptance", basis: "Основание", prepared_by: "worker", reviewer_id: "reviewer", signed_required: false } as DocumentRule;
  for (const [template_id, version] of [["A", 1], ["B", 3], ["A", 5]] as const) {
    vi.mocked(requireTask).mockResolvedValue({ id: "task", template_id, template_version: 1, version,
      request_id: null, common_work_id: "work", building_ids: [], assignee_person_id: "worker", state: "created", prev_state: null,
      is_test: true, created_by: "manager", number: "task", started_at: null, depends_on_task_id: null, access_required: false, is_required: true });
    await applyTaskDocumentRules(deps, exec, makeTestActor("administrator", []), "task", [rule], "Применение методички");
  }
  const keys = vi.mocked(createObligation).mock.calls.map(call => call[3]);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(3);
});
