import { useState, type ReactNode } from "react";
import { Empty, Segmented, Space, Spin, Typography, theme } from "antd";

export type BoardColumn = { value: string; label: string };
export type ListKind = "table" | "board";

/** Выбор вида списка с запоминанием на экран (localStorage, ключ вида «view.<экран>»). */
export function useBoardView(
  storageKey: string,
): [ListKind, (kind: ListKind) => void] {
  const [kind, setKind] = useState<ListKind>(() => {
    try {
      return localStorage.getItem(storageKey) === "board" ? "board" : "table";
    } catch {
      return "table";
    }
  });
  const change = (next: ListKind) => {
    setKind(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Нет доступа к localStorage (приватный режим): вид работает до перезагрузки.
    }
  };
  return [kind, change];
}

/** Тогл «Таблица | Доска» для правого верхнего угла списка. */
export function ViewToggle(props: {
  kind: ListKind;
  onChange: (kind: ListKind) => void;
}) {
  return (
    <Segmented
      aria-label="Вид списка"
      value={props.kind}
      onChange={(value) => props.onChange(value as ListKind)}
      options={[
        { value: "table", label: "Таблица" },
        { value: "board", label: "Доска" },
      ]}
    />
  );
}

/** Канбан-доска только для просмотра: колонки — статусы экрана, клик по карточке открывает её. */
export function BoardView<T>(props: {
  columns: BoardColumn[];
  rows: T[];
  stateOf: (row: T) => string;
  renderCard: (row: T) => ReactNode;
  onOpen?: (row: T) => void;
  loading?: boolean;
  emptyText?: string;
}) {
  const { token } = theme.useToken();
  const grouped = new Map<string, T[]>(
    props.columns.map((c) => [c.value, [] as T[]]),
  );
  const other: T[] = [];
  for (const row of props.rows) {
    const state = props.stateOf(row);
    if (grouped.has(state)) grouped.get(state)!.push(row);
    else other.push(row);
  }
  const columnStyle = {
    flex: "0 0 250px",
    width: 250,
    background: token.colorFillQuaternary,
    borderRadius: token.borderRadiusLG,
    padding: token.paddingSM,
  };
  const card = (row: T) => (
    <div
      key={String((row as { id?: unknown }).id)}
      role={props.onOpen ? "button" : undefined}
      tabIndex={props.onOpen ? 0 : undefined}
      onClick={props.onOpen ? () => props.onOpen!(row) : undefined}
      onKeyDown={
        props.onOpen
          ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onOpen!(row);
            }
          }
          : undefined
      }
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        padding: token.paddingSM,
        cursor: props.onOpen ? "pointer" : "default",
      }}
    >
      {props.renderCard(row)}
    </div>
  );
  const column = (value: string, label: string, items: T[]) => (
    <div key={value} style={columnStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: token.marginSM,
          gap: token.marginXS,
        }}
      >
        <Typography.Text strong ellipsis style={{ flex: 1 }}>
          {label}
        </Typography.Text>
        <Typography.Text type="secondary" data-testid={`board-count-${value}`}>
          {items.length}
        </Typography.Text>
      </div>
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        {items.map(card)}
        {items.length === 0 && (
          <Typography.Text type="secondary">—</Typography.Text>
        )}
      </Space>
    </div>
  );
  if (props.loading && props.rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: token.paddingXL }}>
        <Spin />
      </div>
    );
  }
  if (props.rows.length === 0) {
    return <Empty description={props.emptyText ?? "Записей нет"} />;
  }
  return (
    <div
      style={{
        display: "flex",
        gap: token.marginSM,
        alignItems: "flex-start",
        overflowX: "auto",
        paddingBottom: token.paddingXS,
      }}
    >
      {props.columns.map((c) =>
        column(c.value, c.label, grouped.get(c.value) ?? [])
      )}
      {other.length > 0 && column("__other", "Прочее", other)}
    </div>
  );
}
