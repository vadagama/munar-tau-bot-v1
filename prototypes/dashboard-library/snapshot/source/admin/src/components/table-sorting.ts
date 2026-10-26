import { isValidElement } from "react";
import type { ColumnType, SortOrder } from "antd/es/table/interface";

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

/** Читаем подписи JSX, не вызывая компоненты, обработчики кнопок или действия. */
function cellText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellText).filter(Boolean).join(" ");
  if (isValidElement<{ children?: unknown }>(node)) return cellText(node.props.children);
  if (typeof node === "object" && "children" in node) return cellText(node.children);
  return "";
}

function field(record: unknown, path: readonly unknown[]): unknown {
  let value = record;
  for (const key of path) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[String(key)];
  }
  return value;
}

function valueOf<T>(column: ColumnType<T>, record: T): string | number | null {
  const path: unknown = column.dataIndex;
  const raw = path === undefined ? undefined : field(record, Array.isArray(path) ? path : [path]);
  if (path !== undefined && raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return Number(raw);
  // Сравниваем исходную дату, а не форматированное ДД.ММ.ГГГГ или ISO со смещением.
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const text = cellText(column.render ? column.render(raw, record, 0) : raw).trim();
  return text && text !== "—" ? text : null;
}

export function withColumnSorting<T>(column: ColumnType<T>): ColumnType<T> {
  if (column.sorter !== undefined) return column;
  const title = typeof column.title === "string" ? column.title.trim() : "";
  if (column.dataIndex === undefined && (!column.render || !title || /^Действия?$/.test(title))) return column;
  return { ...column, sorter: (a: T, b: T, order?: SortOrder) => {
    const left = valueOf<T>(column, a), right = valueOf<T>(column, b);
    // AntD инвертирует компаратор для descend: пустые ячейки оставляем внизу.
    if (left === null || right === null) {
      return (left === right ? 0 : left === null ? 1 : -1) * (order === "descend" ? -1 : 1);
    }
    return typeof left === "number" && typeof right === "number"
      ? left - right : collator.compare(String(left), String(right));
  } };
}
