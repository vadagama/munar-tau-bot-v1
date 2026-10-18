import { describe, expect, it } from "vitest";

import { validateTemplate } from "../../templates/engine.ts";
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

  it("длинные вложенные теги закрываются и открываются в каждой части", () => {
    const text =
      '<blockquote><b><a href="https://example.com/path?q=1&amp;x=2">' +
      "Жирный 🙂 &amp; текст ".repeat(1000) + "</a></b></blockquote>";
    const parts = notificationParts(text);
    const bodies = parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, ""));
    expect(parts.length).toBeGreaterThan(1);
    for (const body of bodies) {
      expect(validateTemplate(body, [])).toEqual([]);
      expect(body).toMatch(/^<blockquote><b><a href=/);
      expect(body).toMatch(/<\/a><\/b><\/blockquote>$/);
      expect(body).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(bodies.map((p) => p.replace(/<[^>]*>/g, "")).join("")).toBe(
      text.replace(/<[^>]*>/g, ""),
    );
  });

  it("большой одиночный тег и чрезмерная вложенность не зацикливают разрез", () => {
    for (
      const text of [
        '<a href="https://example.com/' + "x".repeat(6000) + '">' +
        "т".repeat(8500) + "</a>",
        "<b>".repeat(700) + "т".repeat(8500) + "</b>".repeat(700),
      ]
    ) {
      const parts = notificationParts(text);
      expect(parts.every((p) => p.length <= 4096)).toBe(true);
      const bodies = parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, ""));
      expect(bodies.join("")).toBe("т".repeat(8500));
      bodies.forEach((p) => expect(validateTemplate(p, [])).toEqual([]));
    }
  });

  it("неизвестная длинная мнемоника становится буквальным текстом без зависания", () => {
    const text = "&" + "a".repeat(9000) + ";";
    const parts = notificationParts(text);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    const joined = parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, "")).join("");
    expect(joined).toBe("&amp;" + "a".repeat(9000) + ";");
  });

  it("не разрывает emoji и мнемоники на границе внутри форматирования", () => {
    const text = "<b>" + "a".repeat(3988) + "🙂&amp;🙂" + "я".repeat(4000) +
      "</b>";
    const parts = notificationParts(text);
    const bodies = parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, ""));
    for (const body of bodies) expect(validateTemplate(body, [])).toEqual([]);
    const visible = bodies.map((p) => p.replace(/<[^>]*>/g, "")).join("");
    expect(visible).toBe(text.replace(/<[^>]*>/g, ""));
    expect(visible.match(/🙂/g)).toHaveLength(2);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
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
    for (
      const [lang, label] of [
        ["ru", "Открыть задание"],
        ["kk", "Тапсырманы ашу"],
      ] as const
    ) {
      const markup = entryMarkup("task", "З-26-1", lang) as {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
      expect(markup.inline_keyboard[0]![0]!.text).toBe(label);
      expect(markup.inline_keyboard[0]![0]!.callback_data).toBe("/task З-26-1");
    }
  });
});
