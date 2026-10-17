import { describe, expect, it } from "vitest";

import { entryMarkup, notificationParts } from "./text.ts";

describe("notificationParts", () => {
  it("короткое сообщение не режется", () => {
    expect(notificationParts("привет")).toEqual(["привет"]);
  });

  it("длинный обычный текст режется на нумерованные части без потерь", () => {
    const text = "а".repeat(9500);
    const parts = notificationParts(text);
    expect(parts.length).toBe(3);
    expect(parts[0]!.startsWith("[1/3]\n")).toBe(true);
    const joined = parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, "")).join("");
    expect(joined).toBe(text);
  });

  it("граница не рвёт HTML-тег — тег уходит целиком в следующую часть", () => {
    const head = "а".repeat(3998);
    const text = `${head}<b>жирный хвост</b>${"т".repeat(200)}`;
    const parts = notificationParts(text);
    expect(parts.length).toBe(2);
    expect(parts[0]!.endsWith("а")).toBe(true);
    expect(parts[1]!.startsWith("[2/2]\n<b>жирный хвост</b>")).toBe(true);
  });

  it("граница не рвёт мнемонику — мнемоника уходит в следующую часть", () => {
    const head = "а".repeat(3997);
    const text = `${head}&amp;хвост${"т".repeat(200)}`;
    const parts = notificationParts(text);
    expect(parts.length).toBe(2);
    expect(parts[0]!.endsWith("а")).toBe(true);
    expect(parts[1]!.startsWith("[2/2]\n&amp;хвост")).toBe(true);
  });

  it("тег целиком в границе части не мешает разрезу", () => {
    const head = `x${"<b>".repeat(100)}`;
    const text = head + "б".repeat(5000);
    const parts = notificationParts(text);
    expect(parts.length).toBeGreaterThan(1);
    const joined = parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, "")).join("");
    expect(joined).toBe(text);
  });
});

describe("entryMarkup (срез C: точка входа в уведомлении)", () => {
  it("кнопка обращения — callback_data равен команде открытия карточки", () => {
    const markup = entryMarkup("request", "З-26-00001", "ru") as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup.inline_keyboard).toEqual([[
      { text: "Открыть обращение", callback_data: "/request З-26-00001" },
    ]]);
  });

  it("кнопка задания — подпись на языке получателя", () => {
    for (const [lang, label] of [
      ["ru", "Открыть задание"],
      ["kk", "Тапсырманы ашу"],
    ] as const) {
      const markup = entryMarkup("task", "З-26-1", lang) as {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
      expect(markup.inline_keyboard[0]![0]!.text).toBe(label);
      expect(markup.inline_keyboard[0]![0]!.callback_data).toBe("/task З-26-1");
    }
  });
});
