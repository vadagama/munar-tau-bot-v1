// Таблицы для панели (S4a.2): извлечение из JSON-выводов инструментов-агрегатов
// в транскрипте Pi (записи pi.tool-result), по образцу sources.ts. Контракт
// минимален и безопасен: id/title — строки, значения — только текст или конечные
// числа; ограничители 10 колонок и 50 строк. Рендер в кабинете — AssistantTable
// (текст React-нодами, без HTML).

import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ChatTable, ChatTableColumn } from "../protocol.ts";
import { contentText } from "./sources.ts";

export const MAX_TABLE_COLUMNS = 10;
export const MAX_TABLE_ROWS = 50;

/** Значение ячейки: конечное число или строка; прочее — пусто/текст. */
function cell(value: unknown): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "string") return value;
  return value === null || value === undefined ? "" : String(value);
}

function columns(value: unknown): ChatTableColumn[] {
  if (!Array.isArray(value)) return [];
  const out: ChatTableColumn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" && record.key !== "" ? record.key : null;
    const title = typeof record.title === "string" && record.title !== "" ? record.title : null;
    if (key === null || title === null) continue;
    out.push({ key, title, kind: record.kind === "number" ? "number" : "text" });
    if (out.length >= MAX_TABLE_COLUMNS) break;
  }
  return out;
}

/** Таблица из одного вывода инструмента {table:{id,title,columns,rows}}; иначе null. */
export function tableFromToolOutput(text: string): ChatTable | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const table = (parsed as Record<string, unknown>).table;
  if (typeof table !== "object" || table === null) return null;
  const record = table as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id !== "" ? record.id : null;
  const title = typeof record.title === "string" && record.title !== "" ? record.title : null;
  const cols = columns(record.columns);
  if (id === null || title === null || cols.length === 0) return null;
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  const rows: Array<Record<string, string | number>> = [];
  for (const item of rawRows) {
    if (typeof item !== "object" || item === null) continue;
    const source = item as Record<string, unknown>;
    const row: Record<string, string | number> = {};
    for (const col of cols) row[col.key] = cell(source[col.key]);
    rows.push(row);
    if (rows.length >= MAX_TABLE_ROWS) break;
  }
  return { id, title, columns: cols, rows };
}

/**
 * Таблицы из записей транскрипта: только tool-result с разобранным JSON-выводом;
 * дедуп по id — повтор инструмента даёт свежую таблицу (последняя побеждает).
 */
export function collectTables(entries: readonly EntryRecord[]): ChatTable[] {
  const byId = new Map<string, ChatTable>();
  for (const entry of entries) {
    if (entry.kind !== "pi.tool-result") continue;
    const message = entry.model?.[0];
    if (!message) continue;
    const table = tableFromToolOutput(contentText(message.content));
    if (table) byId.set(table.id, table);
  }
  return [...byId.values()];
}

/**
 * Таблицы операции ответа (id включительно): tool-результаты после предыдущего
 * ответа ассистента и до него включительно — Pi исполняет операции последовательно.
 * Таблицы прошлых операций к новым ответам не прилипают (инцидент 26.10.2026:
 * таблица первого отчёта прилипала ко всем последующим ответам сессии).
 */
export function tablesForEntry(entries: readonly EntryRecord[], entryId: number): ChatTable[] {
  let previousAssistantId = -1;
  for (const entry of entries) {
    const id = Number(entry.id);
    if (id >= entryId) break;
    if (entry.kind === "pi.assistant") previousAssistantId = id;
  }
  return collectTables(
    entries.filter((entry) => {
      const id = Number(entry.id);
      return id > previousAssistantId && id <= entryId;
    }),
  );
}
