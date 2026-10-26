// Read-only guard (S2.1/S2.2): хук beforeTool встроенной задачи ToolTask
// блокирует вызов любого инструмента вне белого списка read-only реестра.
// Это защита в глубину поверх самой установки инструментов: расширение, обёртка
// или будущий инструмент записи не получат доступ к данным, даже если окажутся
// в реестре изолята. Решение зависит только от имени вызова — содержимое
// сообщения или аргументов (инъекция инструкций из данных) не влияет на гейт.

import { defineExtension, hook, section, ToolTask, type PromptSection } from "@earendil-works/pi-durable";
import { AGGREGATE_TOOL_NAMES, createAggregateTools } from "./aggregate-tools.ts";
import { createEntityTools, READONLY_TOOL_NAMES, type EntityTool } from "./entity-tools.ts";
import { EntityApiClient } from "./api-client.ts";
import { withToolMetrics } from "./tool-metrics.ts";

/** Полный read-only белый список: инструменты сущностей + агрегаты (S4a.2). */
export const READONLY_NAMES: readonly string[] = [...READONLY_TOOL_NAMES, ...AGGREGATE_TOOL_NAMES];

const READONLY = new Set<string>(READONLY_NAMES);

/** Решение guard'а: undefined — разрешить, { block } — отклонить вызов. */
export function guardToolCall(call: { name: string }): { block: string } | undefined {
  if (READONLY.has(call.name)) return undefined;
  return {
    block:
      `Инструмент «${call.name}» недоступен: ассистент работает только в режиме чтения ` +
      "и отвечает по данным ОСИ через фиксированный набор справочных инструментов.",
  };
}

// Язык профиля — системная инструкция (S6.2): модель держит язык всего ответа
// и не переводит готовые подписи из данных инструментов.
const RU_LANGUAGE_PROMPT =
  "Язык ответов — русский. Отвечай всегда на русском и не переключай язык посреди ответа, " +
  "даже если сотрудник пишет на другом языке. Подписи таблиц и статусы приходят из данных " +
  "инструментов уже на языке профиля — не переводь и не изменяй их сам.";

const KK_LANGUAGE_PROMPT =
  "Жауап тілі — қазақ тілі. Әрқашан қазақ тілінде жауап беріңіз және жауап ортасында тілді " +
  "ауыстырмаңыз. Кесте тақырыптары мен күй-атаулары құрал-деректерден келеді — " +
  "оларды өзіңіз аудармаңыз немесе өзгертпеңіз.";

/** Секция языка профиля: kk — казахская инструкция, иначе русская (S6.2). */
export function languageSection(client: EntityApiClient): PromptSection<EntityTool> {
  return section<EntityTool>("assistant-language", async () => {
    const lang = await client.language();
    return lang === "kk" ? KK_LANGUAGE_PROMPT : RU_LANGUAGE_PROMPT;
  });
}

/**
 * Расширение read-only реестра: инструменты сущностей и агрегатов + guard-хук.
 * Устанавливается в реестр изолята один раз (PiChatRuntime).
 */
export function createEntityExtension(client: EntityApiClient) {
  // Метрики каждого вызова (S6.1): имя/длительность/исход — в лог наблюдаемости,
  // без персональных данных.
  const tools: EntityTool[] = withToolMetrics([
    ...createEntityTools(client),
    ...createAggregateTools(client),
  ]);
  return defineExtension({
    name: "assistant-entities",
    tools,
    sections: [languageSection(client)],
    hooks: [
      hook(ToolTask, {
        beforeTool(call) {
          return guardToolCall(call);
        },
      }),
    ],
  });
}
