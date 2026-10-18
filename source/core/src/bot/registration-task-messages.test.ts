import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrationStep } from "./registration.ts";
import { taskStep } from "./tasks.ts";
import { taskActions } from "./help.ts";
import { TASK_STATE_TEXT } from "../locales/tasks.ts";
import { replyText } from "./keyboard.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Actor } from "../pdp/types.ts";
import type { DbExecutor } from "../db/client.ts";
import type { TemplateStore } from "../templates/store.ts";
import { getTemplate } from "../templates/catalog/index.ts";
import { messagePreview } from "../templates/message.ts";
const { getTask, listTasks } = vi.hoisted(() => ({
  getTask: vi.fn(),
  listTasks: vi.fn(),
}));
vi.mock(
  "../domains/tasks/service.ts",
  () => ({ getTask, listTasks, transitionTask: vi.fn() }),
);
const actor = {
  profile: { id: "profile", language: "ru" },
  person: { id: "person", isTest: true, fullName: "Алия" },
} as Actor;
function harness(
  templates?: TemplateStore,
  initial: Record<string, unknown> = {},
) {
  let state = initial;
  const query: DbExecutor["query"] = async <T>(
    sql: string,
    params?: unknown[],
  ) => {
    if (sql.startsWith("select state from bot_dialog")) {
      return [{ state }] as T[];
    }
    if (sql.startsWith("update bot_dialog")) {
      state = JSON.parse(String(params?.[1]));
      return [];
    }
    if (sql.startsWith("select id,code from building")) {
      return [{ id: "b", code: "Дом <1>" }] as T[];
    }
    if (sql.startsWith("select id from premises")) return [{ id: "p" }] as T[];
    if (sql.startsWith("select phone_e164 from person")) {
      return [{ phone_e164: "+77001234567" }] as T[];
    }
    if (sql.includes("select c.premises_id,c.role,p.kind,p.number,b.code")) {
      return [{
        premises_id: "p",
        role: "owner",
        kind: "apartment",
        number: "4",
        code: "1",
      }] as T[];
    }
    if (sql.startsWith("select id from task")) return [{ id: "t" }] as T[];
    if (sql.startsWith("select r.id,r.state")) {
      return [{
        id: "r",
        state: "pending_review",
        draft: { full_name: "<Алия>" },
        kind: "apartment",
        number: "4",
        code: "1",
        role: "owner",
      }] as T[];
    }
    return [];
  };
  const db = {
    query,
    transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn({ query }),
  };
  return { deps: { db, templates } as RegistryDeps, state: () => state };
}
const store = (
  key: string,
  ru: string,
  buttons?: Record<string, string>,
): TemplateStore =>
  new Map([[key, {
    ru,
    kk: ru,
    version: 1,
    ...(buttons ? { buttons: { ru: buttons, kk: buttons } } : {}),
  }]]);
beforeEach(() => vi.clearAllMocks());
describe("Полные сообщения регистрации и заданий", () => {
  it("/status uses one editable message and safely renders its list", async () => {
    const h = harness(
      store(
        "message.registration.status",
        "<b>Ваши анкеты</b>\n{registrations}\nВсе действия здесь",
        { edit: "Уточнить" },
      ),
    );
    const result = await registrationStep(h.deps, "1", "/status", actor);
    expect(replyText(result)).toBe(
      "<b>Ваши анкеты</b>\n1. <b>Ожидает проверки</b>: &lt;Алия&gt;, Квартира 1/4, Собственник\nВсе действия здесь",
    );
    expect(result).toMatchObject({
      buttons: [[{ text: "Уточнить", data: "/edit 1" }]],
    });
  });
  it("building step renders the same full template in bot and preview", async () => {
    const h = harness(
      store(
        "message.registration.building",
        "<b>Выберите дом</b>\n{buildings}\n/cancel — отмена",
        { building: "Здание {code}" },
      ),
      { step: "phone", full_name: "Алия" },
    );
    const result = await registrationStep(h.deps, "1", "+77001234567", actor);
    expect(replyText(result)).toBe(
      "<b>Выберите дом</b>\n1. Дом &lt;1&gt;\n/cancel — отмена",
    );
    expect(result).toMatchObject({
      buttons: [[{ text: "Здание Дом <1>", data: "1" }]],
    });
    const preview = messagePreview(
      h.deps.templates,
      getTemplate("message.registration.building")!,
    );
    expect(preview.ru.text).toContain("<b>Выберите дом</b>");
    expect(preview.ru.buttons[0]?.[0]).toBe("Здание 1");
  });
  it("consent summary escapes profile values and preserves confirmation action", async () => {
    const h = harness(
      store(
        "message.registration.consent",
        "Проверьте: {full_name}, {phone}, {kind}, {role}\n/cancel",
        { confirm: "Да, всё верно", cancel: "Назад" },
      ),
      {
        step: "role",
        full_name: "<b>Алия</b>",
        phone_e164: "+77001234567",
        kind: "apartment",
      },
    );
    const result = await registrationStep(h.deps, "1", "1", actor);
    expect(replyText(result)).toContain("&lt;b&gt;Алия&lt;/b&gt;");
    expect(result).toMatchObject({
      buttons: [[{ text: "Да, всё верно", data: "да" }, {
        text: "Назад",
        data: "/cancel",
      }]],
    });
  });
  it("task list has one template and editable dynamic buttons", async () => {
    listTasks.mockResolvedValue([{
      number: "З-26-1",
      title: "<Освещение>",
      state: "in_progress",
    }]);
    const h = harness(
      store("message.tasks.list", "<b>Задания</b>\n{tasks}", {
        open: "Открыть {number}",
      }),
    );
    const result = await taskStep(h.deps, "1", "/tasks", actor);
    expect(replyText(result)).toContain("&lt;Освещение&gt;");
    expect(replyText(result)).toMatch(/^<b>Задания<\/b>/);
    expect(result).toMatchObject({
      buttons: [[{ text: "Открыть З-26-1", data: "/task З-26-1" }]],
    });
  });
  it("task card is fully editable while task instruction remains escaped", async () => {
    getTask.mockResolvedValue({
      id: "t",
      number: "З-26-1",
      title: "Свет",
      state: "in_progress",
      instruction: "<i>Проверить</i>",
      due_at: "2026-10-20T10:00:00Z",
      visits: [],
    });
    const h = harness(
      store(
        "message.tasks.card.in_progress",
        "<b>{title}</b>\n{instruction}\nСрок: {due_at}",
        { report: "Подготовить результат" },
      ),
    );
    const result = await taskStep(h.deps, "1", "/task З-26-1", actor);
    expect(replyText(result)).toBe(
      "<b>Свет</b>\n&lt;i&gt;Проверить&lt;/i&gt;\nСрок: 20.10.2026 15:00",
    );
    expect(result).toMatchObject({
      buttons: [[{
        text: "Подготовить результат",
        data: "/reporttask З-26-1",
      }]],
    });
  });
  it.each([
    "awaiting_acceptance",
    "accepted",
    "in_progress",
    "suspended",
    "rework",
    "on_review",
  ])(
    "card variant %s preserves complete default output and actual button",
    async (state) => {
      getTask.mockResolvedValue({
        id: "t",
        number: "З-26-1",
        title: "Свет",
        state,
        instruction: "Проверить",
        due_at: "2026-10-20T10:00:00Z",
        visits: [],
      });
      const result = await taskStep(harness().deps, "1", "/task З-26-1", actor);
      expect(replyText(result)).toBe(
        `<b>З-26-1</b> — Свет\n${
          TASK_STATE_TEXT[state]?.ru
        }\nПроверить\nСрок: 20.10.2026 15:00\n${taskActions(state, "ru")}`,
      );
      const preview = messagePreview(
        undefined,
        getTemplate("message.tasks.card." + state)!,
      );
      if (typeof result !== "string") {
        expect(preview.ru.buttons).toEqual(
          result.buttons?.map((row) => row.map((b) => b.text)),
        );
      }
    },
  );
  it.each(["ru", "kk"] as const)(
    "registration chooser previews match actual %s text and button rows",
    async (language) => {
      const user = { ...actor, profile: { ...actor.profile, language } };
      const cases = [
        {
          key: "message.registration.kind",
          input: "1",
          state: { step: "building", buildings: [{ id: "b" }] },
        },
        {
          key: "message.registration.role",
          input: "4",
          state: { step: "number", building_id: "b", kind: "apartment" },
        },
        { key: "message.registration.add_select", input: "/add", state: {} },
      ];
      for (const test of cases) {
        const result = await registrationStep(
          harness(undefined, test.state).deps,
          "1",
          test.input,
          user,
        );
        const preview =
          messagePreview(undefined, getTemplate(test.key)!)[language];
        expect(replyText(result), test.key).toBe(preview.text);
        expect(typeof result).not.toBe("string");
        if (typeof result !== "string") {
          expect(result.buttons?.map((row) => row.map((b) => b.text)), test.key)
            .toEqual(preview.buttons);
        }
      }
    },
  );
});
