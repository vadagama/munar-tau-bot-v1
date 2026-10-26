// Инструменты агрегатов (S4a.2): «кто как загружен», «создано/закрыто по дням»,
// «просрочка по домам». Read-only GET к /v1/reports/* с JWT пользователя
// (ADR-021: PDP на стороне API), replay: "safe". Модель получает готовую
// таблицу {table, note} — числа приходят из API, а не из памяти модели;
// пустой период — честное «нет данных», без выдуманных строк.

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { EntityApiClient } from "./api-client.ts";
import { failure, textOutput, type EntityTool } from "./entity-tools.ts";

/** Имена инструментов агрегатов — в общий read-only белый список guard'а. */
export const AGGREGATE_TOOL_NAMES: readonly string[] = [
  "workload_by_assignee",
  "created_closed_by_day",
  "overdue_by_building",
];

/** Колонка таблицы для панели: kind number рисуется по правому краю числом. */
export interface AggregateTableColumn {
  key: string;
  title: string;
  kind: "text" | "number";
}

/** Табличный контракт инструмента: панель рисует его через AssistantTable. */
export interface AggregateTable {
  id: string;
  title: string;
  columns: AggregateTableColumn[];
  rows: Array<Record<string, string | number>>;
}

export interface AggregateResult {
  table: AggregateTable;
  note: string;
}

type Lang = "ru" | "kk";

const t = (lang: Lang, ru: string, kk: string) => (lang === "kk" ? kk : ru);

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/** Параметры периода/домов для /v1/reports/агрегат (assignee — только нагрузке). */
function periodParams(args: { from?: string; to?: string; building_id?: string }) {
  return { from: args.from, to: args.to, building_ids: args.building_id };
}

const periodArgs = {
  from: Type.Optional(Type.String({ description: "дата начала периода YYYY-MM-DD (включительно)" })),
  to: Type.Optional(Type.String({ description: "дата конца периода YYYY-MM-DD (включительно)" })),
  building_id: Type.Optional(
    Type.String({ description: "uuid дома — ограничить одним домом из доступной области" }),
  ),
};

// — Таблицы из ответов /v1/reports/* —

const EMPTY_NOTE = {
  workload: { ru: "Нет данных: открытых заданий в доступной области нет.", kk: "Деректер жоқ: қолжетімді аумақта ашық тапсырма жоқ." },
  created_closed: { ru: "Нет данных за выбранный период.", kk: "Таңдалған кезең бойынша деректер жоқ." },
  overdue: { ru: "Нет данных: просроченных обращений в доступной области нет.", kk: "Деректер жоқ: қолжетімді аумақта мерзімі өткен өтініш жоқ." },
} as const;

function workloadTable(data: Record<string, unknown>, lang: Lang): AggregateResult {
  const rows = Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : [];
  const table: AggregateTable = {
    id: "workload_by_assignee",
    title: t(lang, "Нагрузка по исполнителям", "Орындаушылар бойынша жүктеме"),
    columns: [
      { key: "name", title: t(lang, "Исполнитель", "Орындаушы"), kind: "text" },
      { key: "open", title: t(lang, "Открытые", "Ашық"), kind: "number" },
      { key: "overdue", title: t(lang, "Просрочено", "Мерзімі өткен"), kind: "number" },
      { key: "on_review", title: t(lang, "На проверке", "Тексеруде"), kind: "number" },
      { key: "rework", title: t(lang, "На доработке", "Түзетуде"), kind: "number" },
    ],
    rows: rows.map((row) => ({
      name: stringOr(row.name, t(lang, "Без исполнителя", "Орындаушысыз")),
      open: numberOr0(row.open),
      overdue: numberOr0(row.overdue),
      on_review: numberOr0(row.on_review),
      rework: numberOr0(row.rework),
    })),
  };
  if (table.rows.length === 0) return { table, note: t(lang, EMPTY_NOTE.workload.ru, EMPTY_NOTE.workload.kk) };
  const total = numberOr0(data.total);
  const note = t(lang, `Всего открытых заданий: ${total}`, `Барлық ашық тапсырма: ${total}`) +
    (data.truncated === true
      ? t(lang, "; показаны первые 50 исполнителей", "; алғашқы 50 орындаушы көрсетілген")
      : "");
  return { table, note };
}

function createdClosedTable(data: Record<string, unknown>, lang: Lang): AggregateResult {
  const buckets = Array.isArray(data.buckets) ? (data.buckets as Record<string, unknown>[]) : [];
  const table: AggregateTable = {
    id: "created_closed_by_day",
    title: t(lang, "Создано и закрыто по дням", "Күндер бойынша құрылған және жабылған"),
    columns: [
      { key: "day", title: t(lang, "День", "Күні"), kind: "text" },
      { key: "created", title: t(lang, "Создано", "Құрылды"), kind: "number" },
      { key: "closed", title: t(lang, "Закрыто", "Жабылды"), kind: "number" },
    ],
    rows: buckets.map((bucket) => ({
      day: stringOr(bucket.day, ""),
      created: numberOr0(bucket.created),
      closed: numberOr0(bucket.closed),
    })),
  };
  if (table.rows.length === 0) return { table, note: t(lang, EMPTY_NOTE.created_closed.ru, EMPTY_NOTE.created_closed.kk) };
  const totals = (typeof data.totals === "object" && data.totals !== null ? data.totals : {}) as Record<string, unknown>;
  const created = numberOr0(totals.created), closed = numberOr0(totals.closed);
  return {
    table,
    note: t(lang, `Создано: ${created}, закрыто: ${closed} (сутки 05:00→05:00 Алматы)`, `Құрылды: ${created}, жабылды: ${closed} (тәулік 05:00→05:00 Алматы)`),
  };
}

function overdueTable(data: Record<string, unknown>, lang: Lang): AggregateResult {
  const rows = Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : [];
  const table: AggregateTable = {
    id: "overdue_by_building",
    title: t(lang, "Просрочка по домам", "Үйлер бойынша мерзімі өткендер"),
    columns: [
      { key: "building", title: t(lang, "Дом", "Үй"), kind: "text" },
      { key: "overdue", title: t(lang, "Просрочено", "Мерзімі өткен"), kind: "number" },
      { key: "open", title: t(lang, "Открытые", "Ашық"), kind: "number" },
    ],
    rows: rows.map((row) => ({
      building: stringOr(row.label, t(lang, "Без адреса", "Мекенжайсыз")),
      overdue: numberOr0(row.overdue),
      open: numberOr0(row.open),
    })),
  };
  if (table.rows.length === 0) return { table, note: t(lang, EMPTY_NOTE.overdue.ru, EMPTY_NOTE.overdue.kk) };
  const total = numberOr0(data.total);
  const note = t(lang, `Просроченных обращений: ${total}`, `Мерзімі өткен өтініштер: ${total}`) +
    (data.truncated === true
      ? t(lang, "; показаны первые 100 домов", "; алғашқы 100 үй көрсетілген")
      : "");
  return { table, note };
}

/**
 * Фабрика инструментов агрегатов: клиент /v1 инъецируется (в тестах — фейк),
 * в PiChatRuntime ставится в общий read-only реестр рядом с инструментами
 * сущностей (guard.ts).
 */
export function createAggregateTools(client: EntityApiClient): EntityTool[] {
  const workload = defineTool({
    name: "workload_by_assignee",
    replay: "safe",
    description:
      "Нагрузка сотрудников ОСИ по заданиям: открытые, просроченные, на проверке и на доработке — по каждому исполнителю. " +
      "Параметры: from/to — период (даты YYYY-MM-DD, по дате создания); building_id — дом; assignee_id — один сотрудник. " +
      "Возвращает таблицу с числами из отчётов ОСИ.",
    parameters: Type.Object({
      ...periodArgs,
      assignee_id: Type.Optional(
        Type.String({ description: "uuid сотрудника — показать нагрузку одного исполнителя" }),
      ),
    }),
    execute: async (args) => {
      try {
        const lang = await client.language();
        const data = await client.get<Record<string, unknown>>("/v1/reports/workload-by-assignee", {
          ...periodParams(args),
          assignee_id: args.assignee_id,
        });
        return textOutput(workloadTable(data, lang));
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const createdClosed = defineTool({
    name: "created_closed_by_day",
    replay: "safe",
    description:
      "Динамика обращений по суткам (05:00→05:00 Алматы): сколько создано и сколько закрыто в каждый день. " +
      "Параметры: from/to — период (даты YYYY-MM-DD); без периода — текущие сутки; building_id — дом. " +
      "Возвращает таблицу с числами из отчётов ОСИ.",
    parameters: Type.Object(periodArgs),
    execute: async (args) => {
      try {
        const lang = await client.language();
        const data = await client.get<Record<string, unknown>>("/v1/reports/created-closed-by-day", periodParams(args));
        return textOutput(createdClosedTable(data, lang));
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const overdue = defineTool({
    name: "overdue_by_building",
    replay: "safe",
    description:
      "Просроченные обращения по домам: сколько просрочено и сколько всего открытых. " +
      "Параметры: from/to — период (даты YYYY-MM-DD, по дате создания); building_id — дом. " +
      "Возвращает таблицу с числами из отчётов ОСИ.",
    parameters: Type.Object(periodArgs),
    execute: async (args) => {
      try {
        const lang = await client.language();
        const data = await client.get<Record<string, unknown>>("/v1/reports/overdue-by-building", periodParams(args));
        return textOutput(overdueTable(data, lang));
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  return [workload, createdClosed, overdue];
}
