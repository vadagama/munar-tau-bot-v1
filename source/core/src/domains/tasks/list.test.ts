import { expect, it } from "vitest";
import { listTasks } from "./service.ts";
import type { TaskRow } from "./access.ts";
import type { RequestRow } from "../requests/access.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";

const task = { id: "t", request_id: "r", building_ids: [B1], is_test: true, assignee_person_id: "worker" } as TaskRow;
const request: RequestRow = { premises_id: null, version: 1, kind: "request", confirmation_version: 0, id: "r", number: "З-26-42", author_person_id: "resident", building_id: B1,
  state: "in_work", is_test: true, complaint_subject_person_id: null, complaint_route: "standard" };
function deps(row = request) {
  return { db: { query: async (sql: string) => sql.includes("from task t") ? [task] : [row] } } as RegistryDeps;
}
it("список заданий содержит номер обращения для управляющего", async () => {
  const result = await listTasks(deps(), makeTestActor("administrator", [B1], { isTest: true }));
  expect(result[0]?.linked_request).toEqual({ id: "r", number: "З-26-42" });
});
it.each([
  ["worker", request],
  ["admin-other-building", { ...request, building_id: B2 }],
  ["admin-chairman-complaint", { ...request, complaint_route: "chairman" }],
  ["admin-subject", { ...request, complaint_subject_person_id: "worker" }],
  ["admin-draft", { ...request, state: "draft" }],
  ["admin-other-environment", { ...request, is_test: false }],
] as const)("номер обращения не раскрывается: %s", async (kind, row) => {
  const actor = makeTestActor(kind === "worker" ? "executor" : "administrator", [B1], { isTest: true, personId: "worker" });
  const result = await listTasks(deps(row as RequestRow), actor);
  expect(result[0]?.linked_request).toBeNull();
});
it("общее задание без прямого обращения возвращает пустую ссылку", async () => {
  const dependency = { db: { query: async () => [{ ...task, request_id: null }] } } as unknown as RegistryDeps;
  const result = await listTasks(dependency, makeTestActor("chairman", [], { isTest: true }));
  expect(result[0]?.linked_request).toBeNull();
});
