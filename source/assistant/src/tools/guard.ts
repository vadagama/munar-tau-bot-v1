// Read-only guard (S2.1/S2.2): хук beforeTool встроенной задачи ToolTask
// блокирует вызов любого инструмента вне белого списка read-only реестра.
// Это защита в глубину поверх самой установки инструментов: расширение, обёртка
// или будущий инструмент записи не получат доступ к данным, даже если окажутся
// в реестре изолята. Решение зависит только от имени вызова — содержимое
// сообщения или аргументов (инъекция инструкций из данных) не влияет на гейт.

import { defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { createEntityTools, READONLY_TOOL_NAMES, type EntityTool } from "./entity-tools.ts";
import { EntityApiClient } from "./api-client.ts";

const READONLY = new Set<string>(READONLY_TOOL_NAMES);

/** Решение guard'а: undefined — разрешить, { block } — отклонить вызов. */
export function guardToolCall(call: { name: string }): { block: string } | undefined {
  if (READONLY.has(call.name)) return undefined;
  return {
    block:
      `Инструмент «${call.name}» недоступен: ассистент работает только в режиме чтения ` +
      "и отвечает по данным ОСИ через фиксированный набор справочных инструментов.",
  };
}

/**
 * Расширение read-only реестра: десять инструментов сущностей + guard-хук.
 * Устанавливается в реестр изолята один раз (PiChatRuntime).
 */
export function createEntityExtension(client: EntityApiClient) {
  const tools: EntityTool[] = createEntityTools(client);
  return defineExtension({
    name: "assistant-entities",
    tools,
    hooks: [
      hook(ToolTask, {
        beforeTool(call) {
          return guardToolCall(call);
        },
      }),
    ],
  });
}
