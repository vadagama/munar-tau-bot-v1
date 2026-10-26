// Извлечение источников (S2.1): пул карточек-ссылок для панели собирается из
// JSON-выводов read-only инструментов в транскрипте Pi (записи pi.tool-result).
// Безопасность: ссылки только абсолютными путями из серверных выводов; рендер
// дополнительно режет их allow-list путей в AssistantMarkdown (второй рубеж).

import type { EntryRecord } from "@earendil-works/pi-durable";
import { MAX_SOURCES } from "./entity-tools.ts";
import type { ChatSource } from "../protocol.ts";

/** Текст из контента сообщения модели: строка или массив TextContent. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

/** Ссылки из одного вывода инструмента: list-конверт {items} или карточка {label, href}. */
export function sourcesFromToolOutput(text: string): ChatSource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : [record];
  const sources: ChatSource[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const title = row.label;
    const href = row.href;
    if (typeof title !== "string" || title === "") continue;
    if (typeof href !== "string" || !href.startsWith("/")) continue;
    sources.push({ title, href });
  }
  return sources;
}

/**
 * Пул источников из записей транскрипта: только tool-result с разобранным
 * JSON-выводом; дедуп по href; потолок MAX_SOURCES.
 */
export function collectSources(entries: readonly EntryRecord[]): ChatSource[] {
  const byHref = new Map<string, ChatSource>();
  for (const entry of entries) {
    if (entry.kind !== "pi.tool-result") continue;
    const message = entry.model?.[0];
    if (!message) continue;
    for (const source of sourcesFromToolOutput(contentText(message.content))) {
      if (!byHref.has(source.href)) byHref.set(source.href, source);
    }
  }
  return [...byHref.values()].slice(0, MAX_SOURCES);
}

/** Источники, предшествующие записи ответа (id включительно) — для снапшота. */
export function sourcesForEntry(entries: readonly EntryRecord[], entryId: number): ChatSource[] {
  return collectSources(entries.filter((entry) => entry.id <= entryId));
}
