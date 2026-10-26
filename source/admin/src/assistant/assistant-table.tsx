// Таблица агрегата из инструмента ассистента (S4a.2): контракта {id, title,
// columns, rows} из WS done/снапшота. Значения — только текст React-нодами
// (никакого dangerouslySetInnerHTML); числа приходят из API, модель их не
// придумывает. Пустой набор — состояние «Нет данных». Размер ограничен
// повторно в рендере (защита в глубину поверх таблиц из tables.ts).

import { Table, Typography } from "antd";

export interface AssistantTableColumn {
  key: string;
  title: string;
  kind: "text" | "number";
}

export interface AssistantTableData {
  id: string;
  title: string;
  columns: AssistantTableColumn[];
  rows: Array<Record<string, string | number>>;
}

const MAX_COLUMNS = 10;
const MAX_ROWS = 50;

/** Значение ячейки текстом: числа — в ru-локали, прочее — как есть. */
function cellText(value: string | number | undefined): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("ru-RU") : "";
  return value ?? "";
}

export function AssistantTable({ table }: { table: AssistantTableData }) {
  const columns = table.columns.slice(0, MAX_COLUMNS);
  const rows = table.rows.slice(0, MAX_ROWS);
  return (
    <div className="assistant-table" role="region" aria-label={table.title}>
      <Typography.Text type="secondary" className="assistant-table-title">
        {table.title}
      </Typography.Text>
      <Table
        size="small"
        pagination={false}
        rowKey={(_, index) => String(index)}
        dataSource={rows}
        columns={columns.map((column) => ({
          title: column.title,
          dataIndex: column.key,
          key: column.key,
          align: column.kind === "number" ? ("right" as const) : ("left" as const),
          render: (value: string | number | undefined) => <span>{cellText(value)}</span>,
        }))}
        locale={{ emptyText: "Нет данных" }}
      />
    </div>
  );
}
