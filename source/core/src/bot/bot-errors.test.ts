import { describe, expect, it } from "vitest";

import { ApiError } from "../errors/api.ts";
import { botErrorText } from "./bot-errors.ts";

describe("botErrorText", () => {
  it("дефолтное сообщение кода заменяется дружелюбным текстом с подсказкой", () => {
    const text = botErrorText(new ApiError("VALIDATION_FAILED"));
    expect(text).toContain("Не удалось разобрать данные");
    expect(text).toContain("/help");
    expect(text).not.toContain("Валидация");
  });

  it("кастомное сообщение сценария показывается как есть (экранированно)", () => {
    const text = botErrorText(
      new ApiError("VALIDATION_FAILED", "Укажите ID анкеты"),
    );
    expect(text).toContain("Укажите ID анкеты");
    expect(text).toContain("/help");
  });

  it("пользовательский текст экранируется", () => {
    const text = botErrorText(
      new ApiError("VALIDATION_FAILED", "значение <b> не допускается"),
    );
    expect(text).toContain("&lt;b&gt;");
    expect(text).not.toContain("<b>");
  });

  it("неизвестная ошибка — внутренняя формулировка без деталей", () => {
    const text = botErrorText(new Error("secret stack"));
    expect(text).toContain("Техническая ошибка");
    expect(text).not.toContain("secret");
  });
});
