import { describe, expect, it } from "vitest";
import { otherMessageTemplates } from "./catalog/messages-other.ts";
import { noticesTemplates } from "./catalog/notices.ts";
import { renderMessageText } from "./message.ts";
import { botErrorText } from "../bot/bot-errors.ts";
import { ApiError } from "../errors/api.ts";
import { validateTemplate } from "./engine.ts";

describe("законченные сообщения аварий, ошибок и уведомлений", () => {
  it("каждый вариант карточки содержит всё статическое пояснение", () => {
    const def = otherMessageTemplates.find((d) =>
      d.key === "messages.incidents.card_public_forecast_update"
    )!;
    expect(
      renderMessageText(def.ru, {
        number: "А-1",
        title: "<b>Вода</b>",
        description: "Проверяем",
        forecast: "18:00",
        next_update: "17:00",
      }),
    ).toBe(
      "А-1: &lt;b&gt;Вода&lt;/b&gt;\nПроверяем\nПрогноз: 18:00\nСледующее обновление: 17:00",
    );
    expect(def.variables.map((v) => v.name)).not.toContain("text");
  });
  it("переопределение ошибки управляет целым ответом без скрытого суффикса", () => {
    const store = new Map([["messages.errors.FORBIDDEN", {
      ru: "<b>Доступ ограничен</b>\nОбратитесь в ОСИ",
      kk: "Рұқсат жоқ",
    }]]);
    expect(botErrorText(new ApiError("FORBIDDEN"), "ru", store)).toBe(
      "<b>Доступ ограничен</b>\nОбратитесь в ОСИ",
    );
  });
  it("у каждого уведомления есть событие, получатель и пример доставки", () => {
    for (const def of noticesTemplates) {
      expect(def.title).toContain("→");
      expect(def.scenario).toMatch(/^Уведомления · /);
      expect(def.examples?.[0]?.ru).toBeDefined();
    }
  });
  it("каждое полное сообщение проходит HTML-валидацию", () => {
    for (const def of otherMessageTemplates) {
      expect(validateTemplate(def.ru, def.variables.map(v => v.name))).toEqual([]);
      expect(validateTemplate(def.kk, def.variables.map(v => v.name))).toEqual([]);
    }
  });
});
