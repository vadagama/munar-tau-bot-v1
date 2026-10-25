import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbExecutor } from "../db/client.ts";
import { taskStep } from "./tasks.ts";
import { requestStep } from "./requests.ts";
import { replyText } from "./keyboard.ts";
const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  taskTransition: vi.fn(),
  request: vi.fn(),
  addMessage: vi.fn(),rate:vi.fn(),
  submitReport: vi.fn(),
}));
vi.mock(
  "../domains/tasks/service.ts",
  async (original) => ({
    ...await original<typeof import("../domains/tasks/service.ts")>(),
    getTask: mocks.task,
    transitionTask: mocks.taskTransition,
  }),
);
vi.mock(
  "../domains/requests/service.ts",
  async (original) => ({
    ...await original<typeof import("../domains/requests/service.ts")>(),
    getRequest: mocks.request,
  }),
);
vi.mock(
  "../domains/requests/messages.ts",
  async (original) => ({
    ...await original<typeof import("../domains/requests/messages.ts")>(),
    addMessage: mocks.addMessage,rateRequest:mocks.rate,
  }),
);
vi.mock(
  "../domains/tasks/reports.ts",
  () => ({ submitTaskReport: mocks.submitReport }),
);
const actor = {
  profile: { id: "profile", language: "ru" },
  person: { id: "person" },
} as Actor;
function harness(initial = {}) {
  let state = initial;
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
      sql.startsWith("select id from request")
    ) return [{ id: String(p[0]) }] as T[];
    return [];
  };
  return { db: { query, transaction: (fn) => fn({ query }) } } as RegistryDeps;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.mockImplementation(async (_d, _a, id) => ({
    id,
    number: id,
    version: 4,
    state: "awaiting_acceptance",
  }));
  mocks.request.mockImplementation(async (_d, _a, id) => ({
    id,
    number: id,
    version: 8,
    state: "new",
    messages: [],
  }));
  mocks.taskTransition.mockResolvedValue({
    id: "З-1",
    number: "З-1",
    state: "created",
  });
});
it("decline asks for a reason and waits for explicit confirmation", async () => {
  const deps = harness();
  const prompt = await taskStep(deps, "1", "/declinetask З-1", actor);
  expect(replyText(prompt)).toBe("Укажите причину.");
  const preview = await taskStep(deps, "1", "Нет инструмента", actor);
  expect(mocks.taskTransition).not.toHaveBeenCalled();
  const confirm = typeof preview === "string"
    ? ""
    : preview.buttons![0]![0]!.data;
  await taskStep(deps, "1", confirm, actor);
  expect(mocks.taskTransition).toHaveBeenCalledWith(
    expect.anything(),
    actor,
    "З-1",
    expect.objectContaining({
      action: "decline",
      version: 4,
      reason: "Нет инструмента",
    }),
    expect.any(String),
  );
});
it("opening another task invalidates the old reason confirmation", async () => {
  const deps = harness();
  await taskStep(deps, "1", "/declinetask З-1", actor);
  const preview = await taskStep(deps, "1", "Причина", actor);
  const confirm = typeof preview === "string"
    ? ""
    : preview.buttons![0]![0]!.data;
  await taskStep(deps, "1", "/task З-2", actor);
  await taskStep(deps, "1", confirm, actor);
  expect(mocks.taskTransition).not.toHaveBeenCalled();
});
it("a resident message is sent at once with its original request", async () => {
  const deps = harness();
  await requestStep(deps, "1", "/say З-1", actor);
  // Текст сообщения отправляется сразу, без шага предпросмотра.
  await requestStep(deps, "1", "<сообщение>", actor);
  expect(mocks.addMessage).toHaveBeenCalledWith(
    expect.anything(),
    actor,
    "З-1",
    expect.objectContaining({ text: "<сообщение>", channel: "resident" }),
    expect.any(String),
  );
});

it("a legacy resident message still confirms via /rinput", async () => {
  // Диалоги, начатые до отказа от предпросмотра, живут в состоянии с
  // заполненным полем: их явное подтверждение продолжает работать.
  const deps = harness({
    input_form: {
      token: "t1",
      command: "/say",
      object_id: "З-1",
      number: "З-1",
      version: 8,
      title: "Написать сообщение",
      fields: ["text"],
      values: ["<сообщение>"],
      index: 1,
      confirm_command: "/rinput",
      cancel_command: "/request З-1",
    },
  });
  await requestStep(deps, "1", "/rinput t1", actor);
  expect(mocks.addMessage).toHaveBeenCalledWith(
    expect.anything(),
    actor,
    "З-1",
    expect.objectContaining({ text: "<сообщение>", channel: "resident" }),
    expect.any(String),
  );
});

it("a new problem form on task B cannot submit the ready report of task A", async () => {
  const deps = harness({
    scenario: "tasks",
    task_id: "З-1",
    report: { step: "ready", version: 4, task_id: "З-1", evidence: [] },
  });
  await taskStep(deps, "1", "/problem З-2", actor);
  await expect(taskStep(deps, "1", "/submitreport", actor)).rejects
    .toMatchObject({ code: "VALIDATION_FAILED" });
  expect(mocks.submitReport).not.toHaveBeenCalled();
});

it('reading a different result cancels an unfinished resident message',async()=>{
 // Legacy-диалог на шаге подтверждения; чтение другого обращения сбрасывает
 // временную форму — устаревшее подтверждение ничего не отправляет.
 const deps=harness({input_form:{token:'t1',command:'/say',object_id:'З-1',number:'З-1',version:8,title:'Написать сообщение',fields:['text'],values:['Отложенное сообщение'],index:1,confirm_command:'/rinput',cancel_command:'/request З-1'}});
 await requestStep(deps,'1','/result З-2',actor);
 await requestStep(deps,'1','/rinput t1',actor);
 expect(mocks.addMessage).not.toHaveBeenCalled();
});

it('a rating can skip its comment and still requires confirmation',async()=>{
 const deps=harness();const prompt=await requestStep(deps,'1','/rate З-1 5',actor);
 const skip=typeof prompt==='string'?'':prompt.buttons![0]![0]!.data;
 expect(skip).toContain('/rskip ');
 const preview=await requestStep(deps,'1',skip,actor);
 expect(mocks.rate).not.toHaveBeenCalled();
 const confirm=typeof preview==='string'?'':preview.buttons![0]![0]!.data;
 await requestStep(deps,'1',confirm,actor);
 expect(mocks.rate).toHaveBeenCalledWith(expect.anything(),actor,'З-1',{value:5,comment:''});
});
