import { describe, expect, it } from "vitest";
import {
  notificationParts,
  notifyPerson,
  notifyTelegram,
} from "./notifications.ts";
import type { DbExecutor } from "../../db/client.ts";
describe("Доставка длинных инструкций", () => {
  it.each([
    "я".repeat(10000),
    "🛠️".repeat(4000),
    Array.from({ length: 30 }, (_, i) => `JOB-${i}: ${"Задание".repeat(20)}`)
      .join("\n"),
  ])("сохраняет весь текст и ограничивает каждую часть", (text) => {
    const parts = notificationParts(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.map((p) => p.replace(/^\[\d+\/\d+\]\n/, "")).join("")).toBe(
      text,
    );
    expect(parts.some((p) => /[\uD800-\uDBFF]$/.test(p))).toBe(false);
  });
  it("сохраняет короткие сообщения без изменений", () =>
    expect(notificationParts("Готово")).toEqual(["Готово"]));
  it("даёт устойчивый отдельный ключ каждой части обоим каналам", async () => {
    const rows: readonly unknown[][] = [];
    const collected = rows as unknown[][];
    const exec: DbExecutor = {
      async query<T>(
        _sql: string,
        params: readonly unknown[] = [],
      ): Promise<T[]> {
        collected.push([...params]);
        return [];
      },
    };
    for (const enqueue of [notifyPerson, notifyTelegram]) {
      collected.length = 0;
      await enqueue(exec, "123", "А".repeat(10000), "event");
      expect(collected.map((r) => r[2])).toEqual([
        "event",
        "event:part:2",
        "event:part:3",
      ]);
      expect(collected.every((r) => String(r[1]).length <= 4096)).toBe(true);
    }
  });
});
