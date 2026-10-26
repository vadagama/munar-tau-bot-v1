// Тесты извлечения источников (S2.1/S2.2): пул ссылок панели собирается из
// JSON-выводов read-only инструментов в транскрипте Pi (записи pi.tool-result).
// Нераспознанный вывод — не источник; дедуп по href; ссылка без абсолютного
// пути отбрасывается (allow-list в AssistantMarkdown — второй рубеж).

import { describe, expect, it } from "vitest";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { collectSources, contentText, sourcesForEntry, sourcesFromToolOutput } from "./sources.ts";

let nextId = 0;

function toolResultEntry(output: unknown, id?: number, kind = "pi.tool-result"): EntryRecord {
  nextId += 1;
  return {
    id: id ?? nextId,
    conversationId: 1 as EntryRecord["conversationId"],
    kind,
    model: [{ role: "toolResult", content: [{ type: "text", text: JSON.stringify(output) }] }],
  } as unknown as EntryRecord;
}

function assistantEntry(id: number): EntryRecord {
  return {
    id,
    conversationId: 1 as EntryRecord["conversationId"],
    kind: "pi.assistant",
    model: [{ role: "assistant", content: "ответ" }],
  } as unknown as EntryRecord;
}

const listEnvelope = {
  items: [
    { id: "r1", label: "№ОБ-12 · Лифт", state: "Новая", href: "/requests?request=r1&entity_page=1" },
    { id: "r2", label: "№ОБ-13 · Вода", state: "В работе", href: "/requests?request=r2&entity_page=1" },
  ],
  total: 2,
  page: 1,
  has_more: false,
};

describe("sourcesFromToolOutput", () => {
  it("извлекает карточки-ссылки из list-конверта", () => {
    expect(sourcesFromToolOutput(JSON.stringify(listEnvelope))).toEqual([
      { title: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" },
      { title: "№ОБ-13 · Вода", href: "/requests?request=r2&entity_page=1" },
    ]);
  });

  it("извлекает одиночную карточку get-инструмента", () => {
    const card = { id: "r1", label: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" };
    expect(sourcesFromToolOutput(JSON.stringify(card))).toEqual([
      { title: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" },
    ]);
  });

  it("конверт с ошибкой без items — не источник", () => {
    expect(sourcesFromToolOutput(JSON.stringify({ error: "Нет доступа" }))).toEqual([]);
  });

  it("не-JSON вывод (усечённый, текст) — не источник", () => {
    expect(sourcesFromToolOutput("простой текст ответа")).toEqual([]);
  });

  it("item без label или с не-абсолютным href отбрасывается", () => {
    const envelope = {
      items: [
        { id: "x", href: "/requests?request=x" },
        { id: "y", label: "Без пути" },
        { id: "z", label: "Внешняя", href: "https://evil.example/x" },
      ],
    };
    expect(sourcesFromToolOutput(JSON.stringify(envelope))).toEqual([]);
  });
});

describe("collectSources", () => {
  it("собирает ссылки из всех tool-result записей транскрипта, дедуп по href", () => {
    const entries = [
      toolResultEntry(listEnvelope),
      assistantEntry(2),
      toolResultEntry({ id: "r1", label: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" }),
    ];
    const sources = collectSources(entries);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ title: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" });
  });

  it("записи не-tool-result и без model пропускаются", () => {
    const entries = [assistantEntry(1), toolResultEntry(listEnvelope), toolResultEntry({})];
    expect(collectSources(entries)).toHaveLength(2);
  });

  it("ограничивает пул источников (40)", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `i${i}`,
      label: `Запись ${i}`,
      href: `/requests?request=i${i}&entity_page=1`,
    }));
    const sources = collectSources([toolResultEntry({ items, total: 60, page: 1, has_more: true })]);
    expect(sources).toHaveLength(40);
  });

  it("sourcesForEntry берёт только записи до ответа включительно", () => {
    const entries = [
      toolResultEntry(listEnvelope, 1),
      assistantEntry(2),
      toolResultEntry({ items: [{ id: "r9", label: "Поздняя", href: "/requests?request=r9&entity_page=1" }] }, 3),
      assistantEntry(4),
    ];
    const early = sourcesForEntry(entries, 2);
    expect(early).toHaveLength(2);
    const late = sourcesForEntry(entries, 4);
    expect(late).toHaveLength(3);
  });
});

describe("contentText", () => {
  it("склеивает текстовые части и принимает строку", () => {
    expect(contentText([{ type: "text", text: "а" }, { type: "text", text: "б" }])).toBe("аб");
    expect(contentText("строка")).toBe("строка");
    expect(contentText(undefined)).toBe("");
  });
});
