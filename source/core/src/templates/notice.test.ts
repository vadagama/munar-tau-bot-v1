import { expect, it } from "vitest";
import { renderNotice, templateNotice } from "./notice.ts";
import { enqueueNotice } from "../domains/notifications/service.ts";
import type { DbExecutor } from "../db/client.ts";
import { botErrorText, BotTemplateError } from "../bot/bot-errors.ts";
import { workerHelp } from "../bot/help.ts";
import { t } from "./store.ts";
it("новый payload хранит ссылку, старые двуязычные и строковые payload совместимы", async () => {
  const messages: unknown[] = [];
  const exec: DbExecutor = {
    query: async (_sql, params) => {
      messages.push(JSON.parse(String(params?.[0])));
      return [];
    },
  };
  const notice = templateNotice(
    "notices.locales_notifications_author_reminder_1",
    { number: "З-1<&" },
  );
  await enqueueNotice(exec, { personId: "p", key: "once", text: notice });
  expect(messages[0]).toEqual({ personId: "p", key: "once", ...notice });
  expect(renderNotice("Старое", "kk")).toBe("Старое");
  expect(renderNotice({ ru: "Русский", kk: "Қазақша" }, "kk")).toBe("Қазақша");
  const store = new Map([[notice.template, {
    ru: "<b>{number}</b>",
    kk: "Күй: {number}",
  }]]);
  expect(renderNotice(notice, "ru", store)).toBe("<b>З-1&lt;&amp;</b>");
  expect(renderNotice(notice, "kk", store)).toBe("Күй: З-1&lt;&amp;");
});
it("справка и ошибка используют текущий store без двойного экранирования", () => {
  const store = new Map([["help.worker_help", {
    ru: "<b>Команды</b>",
    kk: "<b>Пәрмендер</b>",
  }], ["requests.ukazhite_nomer_obrascheniya", {
    ru: "<b>Номер?</b>",
    kk: "<b>Нөмір?</b>",
  }]]);
  expect(workerHelp("ru", store)).toBe("<b>Команды</b>");
  expect(
    botErrorText(
      new BotTemplateError(
        "VALIDATION_FAILED",
        t(store, "ru", "requests.ukazhite_nomer_obrascheniya"),
      ),
      "ru",
      store,
    ),
  ).toBe("<b>Номер?</b>\n/help — все команды");
});
it("варианты уведомления задания сохраняют весь прежний текст", () => {
  expect(
    renderNotice(
      templateNotice("notices.tasks_service_task_log_2_pause", {
        row_number: "ЗД-1",
        reason: "Нет доступа",
      }),
      "ru",
    ),
  ).toBe(
    "Задание ЗД-1: исполнитель запросил остановку: Нет доступа. Откройте карточку задания.",
  );
  expect(
    renderNotice(
      templateNotice("notices.tasks_service_task_log_2", {
        row_number: "ЗД-1",
        state_kk: "Жұмыста",
      }),
      "kk",
    ),
  ).toBe("ЗД-1 тапсырма: Жұмыста. Тапсырма картасын ашыңыз.");
});
