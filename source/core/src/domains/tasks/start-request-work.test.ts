import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { requireRequest } from "../requests/access.ts";
import { transitionRequestInTransaction } from "../requests/service.ts";
import { createTaskInTransaction } from "./service.ts";
import { requireTask } from "./access.ts";
import { startRequestWork } from "./start-request-work.ts";
vi.mock("../requests/access.ts", () => ({ requireRequest: vi.fn() }));
vi.mock("../requests/service.ts", async original => ({
  ...await original<typeof import("../requests/service.ts")>(),
  transitionRequestInTransaction: vi.fn(),
}));
vi.mock("./service.ts", async original => ({
  ...await original<typeof import("./service.ts")>(), createTaskInTransaction: vi.fn(),
}));
vi.mock("./access.ts", async original => ({
  ...await original<typeof import("./access.ts")>(), requireTask: vi.fn(),
}));
const actor = { person: { id: "admin", isTest: true } } as Actor;
const input = { expected_version: 4, plan: "Устранить течь", assignee_person_id: "worker", due_at: "2099-01-01T10:00:00Z" };
let records: Record<string, unknown>[], committed: boolean;
let deps: RegistryDeps, exec: DbExecutor;
beforeEach(() => {
  vi.clearAllMocks(); records = []; committed = false;
  exec = { query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (sql.startsWith("select request_hash")) return records;
    if (sql.startsWith("insert into idempotency_key")) records.push({ request_hash: params![2], response: JSON.parse(String(params![3])) });
    if (sql.startsWith("select concat_ws")) return [{ label: "Дом 1, квартира, 4" }];
    return [];
  }) } as DbExecutor;
  deps = { db: { transaction: async (fn: (tx: DbExecutor) => Promise<unknown>) => {
    try { const result = await fn(exec); committed = true; return result; }
    catch (error) { records = []; throw error; }
  } }, audit: {} } as RegistryDeps;
  vi.mocked(requireRequest).mockResolvedValue({ id: "r", number: "З-1", version: 4, state: "reviewing", kind: "complaint", building_id: "b", premises_id: "p" } as never);
  vi.mocked(createTaskInTransaction).mockResolvedValue({ id: "t", number: "ЗД-1", state: "awaiting_acceptance" } as never);
  vi.mocked(transitionRequestInTransaction).mockResolvedValue({ id: "r", state: "in_work", version: 5 });
});
it("создаёт обязательное задание и переход в одной транзакции, повтор возвращает то же задание", async () => {
  const first = await startRequestWork(deps, actor, "r", input, "key");
  expect(committed).toBe(true);
  expect(createTaskInTransaction).toHaveBeenCalledWith(deps, exec, actor, expect.objectContaining({
    request_id: "r", title: "Обращение З-1", instruction: "Дом 1, квартира, 4\n\nУстранить течь", assignee_person_id: "worker", is_required: true,
  }));
  expect(transitionRequestInTransaction).toHaveBeenCalledWith(deps, exec, actor, "r", expect.objectContaining({ action: "start_work", expected_version: 4, payload: { plan: input.plan, task_id: "t" } }));
  expect(await startRequestWork(deps, actor, "r", input, "key")).toEqual(first);
  expect(createTaskInTransaction).toHaveBeenCalledTimes(1);
  expect(requireTask).toHaveBeenCalledWith(exec, actor, "t", "task.manage");
});
it("ошибка перехода не фиксирует ни операцию, ни ключ повтора", async () => {
  vi.mocked(transitionRequestInTransaction).mockRejectedValueOnce(new Error("transition failed"));
  await expect(startRequestWork(deps, actor, "r", input, "key")).rejects.toThrow("transition failed");
  expect(committed).toBe(false); expect(records).toHaveLength(0);
});
it("недоступный исполнитель не переводит обращение в работу", async () => {
  vi.mocked(createTaskInTransaction).mockRejectedValueOnce(new Error("assignee denied"));
  await expect(startRequestWork(deps, actor, "r", input, "key")).rejects.toThrow("assignee denied");
  expect(transitionRequestInTransaction).not.toHaveBeenCalled(); expect(committed).toBe(false);
});
it.each([
  [{ ...input, expected_version: 3 }, "CONCURRENT_MODIFICATION"],
  [{ ...input, due_at: "2020-01-01T10:00:00Z" }, "VALIDATION_FAILED"],
  [{ ...input, assignee_person_id: "" }, "VALIDATION_FAILED"],
])("проверяет версию, срок и исполнителя до создания", async (body, code) => {
  await expect(startRequestWork(deps, actor, "r", body, "key")).rejects.toMatchObject({ code });
  expect(createTaskInTransaction).not.toHaveBeenCalled();
});

it("сохраняет адрес одной строкой при отсутствии дома",async()=>{
 vi.mocked(requireRequest).mockResolvedValue({id:'r',number:'З-1',version:4,state:'reviewing',building_id:null,premises_id:null,location_text:'У въезда со стороны школы'} as never);
 vi.mocked(exec.query).mockImplementation(async(sql)=>sql.startsWith('select concat_ws')?[]:[]);
 await startRequestWork(deps,actor,'r',input,'address-key');
 expect(createTaskInTransaction).toHaveBeenCalledWith(deps,exec,actor,expect.objectContaining({instruction:'У въезда со стороны школы\n\nУстранить течь'}));
});
