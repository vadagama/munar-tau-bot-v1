// Метрики вызовов инструментов (S6.1): каждый execute оборачивается таймером и
// счётчиком исхода — structured log без персональных данных (имя инструмента,
// длительность, ok). Прямая обёртка execute вместо wrapTool из pi-durable:
// инструменты реестра создаются здесь же (guard.ts), обёртка по имени нужна
// только для чужих расширений — отклонение зафиксировано в реестре задач.

import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { EntityTool } from "./entity-tools.ts";

export function withToolMetrics(tools: readonly EntityTool[]): EntityTool[] {
  return tools.map((tool) => {
    const execute = tool.execute as unknown as (
      args: unknown,
      api: ToolExecutionApi,
      context: unknown,
    ) => Promise<unknown>;
    const wrapped = async (args: unknown, api: ToolExecutionApi, context: unknown): Promise<unknown> => {
      const started = Date.now();
      try {
        const result = await execute(args, api, context);
        logToolCall(tool.name, Date.now() - started, true);
        return result;
      } catch (error) {
        logToolCall(tool.name, Date.now() - started, false);
        throw error;
      }
    };
    return { ...tool, execute: wrapped as unknown as EntityTool["execute"] };
  });
}

function logToolCall(tool: string, ms: number, ok: boolean): void {
  console.log(JSON.stringify({ event: "tool_call", tool, ms, ok }));
}
