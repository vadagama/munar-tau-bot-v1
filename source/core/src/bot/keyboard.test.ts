/**
 * Модульные тесты кнопок (срез UX B): callback_data равен текстовой команде,
 * лимит 64 байта защищает от отказа Telegram, эмуляция получает только текст.
 */
import { describe, expect, it } from "vitest";

import { btn, copyBtn, inlineMarkup, REMOVE_KEYBOARD, replyText } from "./keyboard.ts";
import { ApiError } from "../errors/api.ts";

describe("btn", () => {
  it("создаёт кнопку с текстовым эквивалентом", () => {
    expect(btn("Принять", "/confirm З-26-1 2")).toEqual({
      text: "Принять",
      data: "/confirm З-26-1 2",
    });
  });
  it("64 байта проходят, длиннее — ошибка программиста", () => {
    expect(() => btn("ок", "a".repeat(64))).not.toThrow();
    expect(() => btn("длинно", "a".repeat(65))).toThrow(ApiError);
    // Кириллица — 2 байта на символ.
    expect(() => btn("ок", "ж".repeat(32))).not.toThrow();
    expect(() => btn("длинно", "ж".repeat(33))).toThrow(ApiError);
  });
});

describe("copyBtn", () => {
  it("копирующая кнопка несёт текст для буфера обмена без лимита callback_data", () => {
    const link = `https://t.me/munar_tau_user_bot?start=invite_${"a".repeat(64)}`;
    expect(copyBtn("Копировать", link)).toEqual({
      text: "Копировать",
      data: link,
      copy: true,
    });
  });
  it("лимит copy_text — 1–256 символов, нарушение — ошибка программиста", () => {
    expect(() => copyBtn("Копировать", "a".repeat(256))).not.toThrow();
    expect(() => copyBtn("Копировать", "a".repeat(257))).toThrow(ApiError);
    expect(() => copyBtn("Копировать", "")).toThrow(ApiError);
  });
});

describe("replyText", () => {
  it("строка проходит как есть, объект — только текст", () => {
    expect(replyText("привет")).toBe("привет");
    expect(
      replyText({ text: "текст", buttons: [[btn("да", "да")]] }),
    ).toBe("текст");
  });
});

describe("inlineMarkup", () => {
  it("ряды кнопок превращаются в inline_keyboard", () => {
    expect(
      inlineMarkup([[btn("Да", "да"), btn("Нет", "нет")], [btn("Отмена", "/cancel")]]),
    ).toEqual({
      inline_keyboard: [
        [{ text: "Да", callback_data: "да" }, { text: "Нет", callback_data: "нет" }],
        [{ text: "Отмена", callback_data: "/cancel" }],
      ],
    });
  });
  it("копирующая кнопка уходит полем copy_text, а не callback_data", () => {
    expect(
      inlineMarkup([[copyBtn("Копировать", "https://t.me/munar_tau_user_bot?start=invite_abc")]]),
    ).toEqual({
      inline_keyboard: [
        [{ text: "Копировать", copy_text: { text: "https://t.me/munar_tau_user_bot?start=invite_abc" } }],
      ],
    });
  });
});

describe("REMOVE_KEYBOARD", () => {
  it("разметка удаления reply-клавиатуры уходит ровно в поле Telegram", () => {
    expect(REMOVE_KEYBOARD).toEqual({ remove_keyboard: true });
  });
});
