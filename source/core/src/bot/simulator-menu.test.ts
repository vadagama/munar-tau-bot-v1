import { describe, expect, it } from "vitest";
import { withSimulatorMenu } from "./simulator-menu.ts";
import { EMPTY_TEMPLATE_STORE } from "../templates/store.ts";

describe("меню симулятора", () => {
  it("сохраняет inline-кнопки и маршрутизирует главное меню между сценариями", () => {
    const buttons = [[{ text: "Да", data: "да" }]];
    const reply = withSimulatorMenu({ text: "Ответ", buttons }, "registration", "ru", EMPTY_TEMPLATE_STORE);
    expect(reply).toMatchObject({ text: "Ответ", buttons });
    if (typeof reply === "string") throw new Error("Ожидалось меню");
    expect(reply.menu?.flat()).toContainEqual({ text: "🆕 Новое обращение", data: "/newrequest", scenario: "requests" });
    expect(reply.menu?.flat()).toContainEqual({ text: "⚙️ Настройки", data: "/notifications", scenario: "notifications" });
  });

  it("использует казахские подписи и переопределения каталога", () => {
    const store = new Map([["help.welcome_text", {
      ru: "", kk: "", buttons: { ru: {}, kk: { objects: "Үйім" } },
    }]]);
    const reply = withSimulatorMenu("Ответ", "incidents", "kk", store);
    if (typeof reply === "string") throw new Error("Ожидалось меню");
    expect(reply.menu?.flat()).toContainEqual({ text: "Үйім", data: "/objects", scenario: "registration" });
  });

  it("для заданий показывает меню бота сотрудников", () => {
    const reply = withSimulatorMenu("Ответ", "tasks", "ru", EMPTY_TEMPLATE_STORE);
    if (typeof reply === "string") throw new Error("Ожидалось меню");
    expect(reply.menu?.flat().map(button => button.data)).toEqual(["/tasks", "/staffrequests", "/notifications", "/help"]);
  });
});

it.each(["registration", "tasks"])("симулятор не добавляет меню к справке %s", scenario => {
  expect(withSimulatorMenu("Справка", scenario, "ru", EMPTY_TEMPLATE_STORE, "/help")).toBe("Справка");
});
