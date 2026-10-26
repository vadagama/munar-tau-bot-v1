// Тесты метрик вызовов инструментов (S6.1): длительность и исход каждого
// execute — в structured log без персональных данных: только имя инструмента,
// миллисекунды и ok. Лог наблюдаемости Worker'а собирает их в Cloudflare.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { withToolMetrics } from "./tool-metrics.ts";
import type { EntityTool } from "./entity-tools.ts";

const api = {} as ToolExecutionApi;
// Третий параметр execute — Context pi-durable; в тестах фейковый объект.
const context = {} as never;

function fakeTool(overrides: Record<string, unknown> = {}): EntityTool {
  return {
    name: "search_requests",
    execute: async () => ({ output: { type: "text", text: "ok" } }),
    ...overrides,
  } as unknown as EntityTool;
}

describe("withToolMetrics", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => {
    log.mockClear();
  });

  it("успешный вызов: результат проходит сквозь обёртку, в логе имя, длительность, ok:true", async () => {
    const [tool] = withToolMetrics([fakeTool()]);
    const result = await tool!.execute({ search: "лифт" } as never, api, context);
    expect(result).toEqual({ output: { type: "text", text: "ok" } });
    const entry = JSON.parse(String(log.mock.lastCall?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({ event: "tool_call", tool: "search_requests", ok: true });
    expect(entry.ms).toBeTypeOf("number");
  });

  it("ошибка: исключение сохраняется как есть, в логе ok:false", async () => {
    const [tool] = withToolMetrics([
      fakeTool({
        execute: async () => {
          throw new Error("api down");
        },
      }),
    ]);
    await expect(tool!.execute({} as never, api, context)).rejects.toThrow("api down");
    const entry = JSON.parse(String(log.mock.lastCall?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({ event: "tool_call", tool: "search_requests", ok: false });
  });

  it("аргументы, api и контекст передаются в исходный execute без изменений", async () => {
    const execute = vi.fn(async () => ({}));
    const [tool] = withToolMetrics([fakeTool({ execute })]);
    await tool!.execute({ a: 1 } as never, api, context);
    expect(execute).toHaveBeenCalledWith({ a: 1 }, api, context);
  });

  it("в лог не попадают персональные данные: только имя, мс и ok", async () => {
    const [tool] = withToolMetrics([fakeTool()]);
    await tool!.execute({ search: "Иванов Иван, +7 777 000-00-00" } as never, api, context);
    const raw = String(log.mock.lastCall?.[0]);
    expect(raw).not.toContain("Иванов");
    expect(raw).not.toContain("777");
  });

  it("все инструменты массива обёрнуты, имена сохранены", () => {
    const wrapped = withToolMetrics([fakeTool(), fakeTool({ name: "get_task" })]);
    expect(wrapped.map((tool) => tool.name)).toEqual(["search_requests", "get_task"]);
  });
});
