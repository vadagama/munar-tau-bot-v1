// Тесты табличного контракта панели (S4a.2): таблицы собираются из JSON-выводов
// инструментов-агрегатов в транскрипте Pi; не-JSON/битый вывод — не таблица;
// дедуп по id (повтор — свежая таблица); ограничители 10 колонок и 50 строк;
// значения сводятся к тексту или конечным числам.

import { describe, expect, it } from "vitest";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { collectTables, tableFromToolOutput, tablesForEntry } from "./tables.ts";

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

const workloadTable = {
  table: {
    id: "workload_by_assignee",
    title: "Нагрузка по исполнителям",
    columns: [
      { key: "name", title: "Исполнитель", kind: "text" },
      { key: "open", title: "Открытые", kind: "number" },
    ],
    rows: [
      { name: "Петров Пётр", open: 3 },
      { name: "Без исполнителя", open: 2 },
    ],
  },
  note: "Всего открытых заданий: 5",
};

describe("tableFromToolOutput", () => {
  it("извлекает таблицу с колонками и приведёнными значениями", () => {
    const table = tableFromToolOutput(JSON.stringify(workloadTable));
    expect(table).toEqual({
      id: "workload_by_assignee",
      title: "Нагрузка по исполнителям",
      columns: [
        { key: "name", title: "Исполнитель", kind: "text" },
        { key: "open", title: "Открытые", kind: "number" },
      ],
      rows: [
        { name: "Петров Пётр", open: 3 },
        { name: "Без исполнителя", open: 2 },
      ],
    });
  });

  it("прочие типы ячеек сводятся к строке/пусто, число Infinity отбрасывается", () => {
    const output = {
      table: {
        id: "t", title: "Т",
        columns: [{ key: "a", title: "А" }, { key: "b", title: "Б", kind: "number" }],
        rows: [{ a: { x: 1 }, b: Number.POSITIVE_INFINITY }, { a: null, b: true }],
      },
    };
    const table = tableFromToolOutput(JSON.stringify(output, (key, value) =>
      value === Number.POSITIVE_INFINITY ? "Infinity" : value));
    expect(table?.rows).toEqual([
      { a: "[object Object]", b: "Infinity" },
      { a: "", b: "true" },
    ]);
  });

  it("конверт с ошибкой, не-JSON и вывод без таблицы — null", () => {
    expect(tableFromToolOutput(JSON.stringify({ error: "Нет доступа" }))).toBeNull();
    expect(tableFromToolOutput("текст ответа")).toBeNull();
    expect(tableFromToolOutput(JSON.stringify({ table: { id: "t" } }))).toBeNull();
    expect(tableFromToolOutput(JSON.stringify({
      table: { id: "t", title: "Т", columns: [], rows: [] },
    }))).toBeNull();
  });

  it("ограничители: 10 колонок и 50 строк", () => {
    const cols = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, title: `К${i}`, kind: "number" }));
    const rows = Array.from({ length: 60 }, (_, i) => Object.fromEntries(cols.map((c) => [c.key, i])));
    const table = tableFromToolOutput(JSON.stringify({
      table: { id: "t", title: "Т", columns: cols, rows },
    }));
    expect(table?.columns).toHaveLength(10);
    expect(table?.rows).toHaveLength(50);
    expect(Object.keys(table?.rows[0] ?? {})).toHaveLength(10);
  });
});

describe("collectTables", () => {
  it("собирает таблицы из tool-result записей, повтор инструмента замещает таблицу", () => {
    const fresh = {
      table: { ...workloadTable.table, rows: [{ name: "Другой", open: 7 }] },
      note: "обновлено",
    };
    const entries = [
      toolResultEntry(workloadTable),
      assistantEntry(2),
      toolResultEntry(fresh),
    ];
    const tables = collectTables(entries);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows).toEqual([{ name: "Другой", open: 7 }]);
  });

  it("разные id дают несколько таблиц в порядке первого появления", () => {
    const entries = [
      toolResultEntry(workloadTable),
      toolResultEntry({
        table: { id: "created_closed_by_day", title: "Динамика", columns: [{ key: "day", title: "День" }], rows: [] },
      }),
    ];
    expect(collectTables(entries).map((t) => t.id)).toEqual(["workload_by_assignee", "created_closed_by_day"]);
  });

  it("не-tool-result записи и записи без model пропускаются", () => {
    const entries = [assistantEntry(1), toolResultEntry(workloadTable), toolResultEntry({})];
    expect(collectTables(entries)).toHaveLength(1);
  });

  it("tablesForEntry берёт только таблицы операции ответа: после предыдущего ответа и до него включительно", () => {
    // Инцидент 26.10.2026: таблица отчёта из первой операции прилипала ко всем
    // последующим ответам сессии — панель рисовала таблицу на каждый вопрос.
    const entries = [
      toolResultEntry(workloadTable, 1),
      assistantEntry(2),
      toolResultEntry({ table: { id: "late", title: "Поздняя", columns: [{ key: "a", title: "А" }], rows: [] } }, 3),
      assistantEntry(4),
    ];
    expect(tablesForEntry(entries, 2).map((t) => t.id)).toEqual(["workload_by_assignee"]);
    expect(tablesForEntry(entries, 4).map((t) => t.id)).toEqual(["late"]);
  });

  it("несколько таблиц одной операции собираются вместе", () => {
    const entries = [
      toolResultEntry(workloadTable, 1),
      toolResultEntry({ table: { id: "overdue_by_building", title: "Просрочка", columns: [{ key: "b", title: "Б" }], rows: [] } }, 2),
      assistantEntry(3),
    ];
    expect(tablesForEntry(entries, 3).map((t) => t.id)).toEqual(["workload_by_assignee", "overdue_by_building"]);
  });
});
