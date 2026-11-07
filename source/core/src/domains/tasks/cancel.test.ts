import { expect, it, vi } from "vitest";
import type { DbClient } from "../../db/client.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";
import type { StaffRole } from "../../pdp/types.ts";
import { transitionTask } from "./service.ts";
import type { TaskRow } from "./access.ts";
import { requiredTasksAccepted } from "./fsm.ts";

vi.mock("./timing.ts", () => ({ syncTaskTimers: vi.fn() }));
vi.mock("../registrations/notifications.ts", () => ({ notifyPerson: vi.fn() }));

function fixture(role: StaffRole = "administrator", startedDependent = false) {
  const actor = makeTestActor(role, [B1]);
  let task: TaskRow = {
    id: "t", request_id: "r", common_work_id: null, building_ids: [B1],
    assignee_person_id: null, state: "created", prev_state: null, is_test: false,
    version: 1, created_by: actor.person.id, number: "ЗД-1", started_at: null,
    depends_on_task_id: null, access_required: false, is_required: true,
  };
  const logs: unknown[][] = [];
  const db: DbClient = {
    async query<T>(sql: string, p: readonly unknown[] = []): Promise<T[]> {
      if (sql.startsWith("select t.*") && sql.includes("where t.id=$1")) {
        return (p[0] === "t" ? [task] : p[0] === "replacement" ? [{ ...task, id: "replacement", state: "created" }] : []) as T[];
      }
      if (sql === "select state from request where id=$1 for update") return [{ state: "in_work" }] as T[];
      if (sql.includes("from task where depends_on_task_id=$1")) return (startedDependent ? [{ id: "dependent", started_at: "2026-11-01T00:00:00Z" }] : []) as T[];
      if (sql.startsWith("update task set state=")) task = { ...task, state: p[1] as TaskRow["state"], is_required: p[9] ? false : task.is_required, version: task.version + 1 };
      if (sql.includes("insert into task_log")) logs.push([...p]);
      return [];
    },
    transaction: fn => fn(db),
    close: async () => {},
  };
  return { actor, deps: { db, audit: { append: vi.fn(), list: vi.fn() } }, logs };
}
const input = { action: "cancel", version: 1, reason: "Работа больше не требуется", stop_checked: true };

it.each(["administrator", "chairman"] as const)("%s отменяет без замены, сохраняя обязательный объём и причину", async role => {
  const { actor, deps, logs } = fixture(role);
  const row = await transitionTask(deps, actor, "t", input, "cancel");
  expect(row).toMatchObject({ state: "canceled", is_required: true, version: 2 });
  expect(logs[0]?.[4]).toBe(input.reason);
  expect(requiredTasksAccepted([{ state: row.state, isRequired: row.is_required, started: false }])).toBe(false);
});
it.each([{ reason: "  " }, { stop_checked: false }])("отмена без замены сохраняет обязательные проверки %j", async override => {
  const { actor, deps } = fixture();
  await expect(transitionTask(deps, actor, "t", { ...input, ...override }, "cancel"))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("исполнитель не может отменить задание", async () => {
  const { actor, deps } = fixture("executor");
  await expect(transitionTask(deps, actor, "t", input, "cancel")).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("начатая зависимая работа требует разбора даже без замены", async () => {
  const { actor, deps } = fixture("administrator", true);
  await expect(transitionTask(deps, actor, "t", input, "cancel")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await transitionTask(deps, actor, "t", { ...input, dependency_review: "Остановка согласована" }, "reviewed"))
    .toMatchObject({ state: "canceled", is_required: true });
});
it("явная замена отменённого задания по-прежнему требует замену", async () => {
  const { actor, deps } = fixture();
  await transitionTask(deps, actor, "t", input, "cancel");
  await expect(transitionTask(deps, actor, "t", { ...input, action: "replace_canceled", version: 2 }, "replace"))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it.each([false, true])("сохраняет немедленную и последующую замену (отложена: %s)", async deferred => {
  const { actor, deps, logs } = fixture();
  if (deferred) await transitionTask(deps, actor, "t", input, "cancel");
  const row = await transitionTask(deps, actor, "t", {
    ...input, action: deferred ? "replace_canceled" : "cancel", version: deferred ? 2 : 1,
    replacement_task_id: "replacement",
  }, "replace");
  expect(row).toMatchObject({ state: "canceled", is_required: false });
  expect(JSON.parse(String(logs.at(-1)?.[5]))).toMatchObject({ was_required: true, replacement_task_id: "replacement" });
});
it("отмена без замены отклоняет устаревшую версию", async () => {
  const { actor, deps } = fixture();
  await expect(transitionTask(deps, actor, "t", { ...input, version: 0 }, "stale"))
    .rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
});
