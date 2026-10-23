import type { TemplateOverride } from "./store.ts";
import { expect, it } from "vitest";
import {
  menuCommand,
  validateMenuLabels,
} from "../bot/help.ts";
import { messagePreview } from "./message.ts";
import { getTemplate } from "./catalog/index.ts";
it("редактируемое меню использует те же подписи в предпросмотре и маршрутизации", () => {
  const store = new Map<string, TemplateOverride>([["help.welcome_text", {
    ru: "Добро пожаловать",
    kk: "Қош келдіңіз",
    buttons: {
      ru: { newrequest: "Создать заявку" },
      kk: { newrequest: "Өтініш беру" },
    },
  }]]);
  expect(menuCommand("Создать заявку", store)).toBe("/newrequest");
  expect(menuCommand("Өтініш беру", store)).toBe("/newrequest");
  expect(menuCommand("🆕 Новое обращение", store)).toBe("/newrequest");
  // Reply-меню больше не отправляется, но подписи предпросмотра каталога
  // обязаны маршрутизироваться: старые клиенты присылают их текстом.
  for (const labelText of messagePreview(store, getTemplate("help.welcome_text")!).ru.buttons?.flat() ?? []) {
    expect(menuCommand(labelText, store)).toBeDefined();
  }
  for (const labelText of messagePreview(undefined, getTemplate("help.worker_help")!).kk.buttons?.flat() ?? []) {
    expect(menuCommand(labelText, store)).toBeDefined();
  }
  expect(validateMenuLabels(store)).toEqual([]);
});
it("запрещает коллизии между языками, карточками и прежними подписями", () => {
  const store = new Map<string, TemplateOverride>([["help.welcome_text", {
    ru: "x",
    kk: "x",
    buttons: { ru: { newrequest: "❓ Помощь" }, kk: {} },
  }]]);
  expect(validateMenuLabels(store)).not.toEqual([]);
  const custom = new Map<string, TemplateOverride>([["help.welcome_text", {
    ru: "x",
    kk: "x",
    buttons: { ru: { newrequest: "Открыть" }, kk: {} },
  }], ["help.worker_help", {
    ru: "x",
    kk: "x",
    buttons: { kk: { tasks: "Открыть" }, ru: {} },
  }]]);
  expect(validateMenuLabels(custom)).not.toEqual([]);
});
it("уведомление показывает подпись кнопки открытия в той же карточке", () => {
  const def = getTemplate("notices.requests_messages_add_message_1")!;
  const store = new Map<string, TemplateOverride>([[def.key, {
    ru: def.ru,
    kk: def.kk,
    buttons: { ru: { request: "Перейти к переписке" }, kk: {} },
  }]]);
  expect(messagePreview(store, def).ru.buttons).toEqual([[
    "Перейти к переписке",
  ]]);
});
it("старые пользовательские клавиатуры работают после переименования и сброса", () => {
  const old = {
    ru: { newrequest: "Подать заявку" },
    kk: { newrequest: "Өтініш беру" },
  };
  const renamed = new Map<string, TemplateOverride>([["help.welcome_text", {
    ru: "x",
    kk: "x",
    buttons: { ru: { newrequest: "Создать обращение" }, kk: {} },
    historicalButtons: [old],
  }]]);
  expect(menuCommand("Подать заявку", renamed)).toBe("/newrequest");
  expect(menuCommand("Өтініш беру", renamed)).toBe("/newrequest");
  expect(menuCommand("Создать обращение", renamed)).toBe("/newrequest");
  expect(validateMenuLabels(renamed)).toEqual([]);
  const reset = new Map<string, TemplateOverride>([["help.welcome_text", {
    ru: "x",
    kk: "x",
    useDefault: true,
    buttons: { ru: {}, kk: {} },
    historicalButtons: [old, renamed.get("help.welcome_text")!.buttons!],
  }]]);
  expect(menuCommand("Подать заявку", reset)).toBe("/newrequest");
  expect(menuCommand("Создать обращение", reset)).toBe("/newrequest");
  expect(menuCommand("🆕 Новое обращение", reset)).toBe("/newrequest");
  expect(validateMenuLabels(reset)).toEqual([]);
  reset.set("help.worker_help", {
    ru: "x",
    kk: "x",
    buttons: { ru: { tasks: "Подать заявку" }, kk: {} },
  });
  expect(validateMenuLabels(reset)).toContain(
    "Подпись кнопки «Подать заявку» конфликтует с другой командой",
  );
});
