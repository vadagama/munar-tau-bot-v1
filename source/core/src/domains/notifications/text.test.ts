import { describe, expect, it } from "vitest";

import { notificationParts } from "./text.ts";

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
