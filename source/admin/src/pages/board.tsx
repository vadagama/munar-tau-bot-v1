import { useState, type CSSProperties, type ReactNode } from "react";
import { Empty, Segmented, Space, Spin, Typography, theme } from "antd";
import "./board.css";
import { useMobile } from "../lib/use-mobile";

export type BoardColumn = { value: string; label: string };
export type ListKind = "table" | "board";

/** Выбор вида списка с запоминанием на экран (localStorage, ключ вида «view.<экран>»). */
export function useBoardView(
  storageKey: string,
): [ListKind, (kind: ListKind) => void] {
  const mobile = useMobile();
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
  return [mobile ? "table" : kind, change];
}

/** Тогл «Таблица | Доска» для правого верхнего угла списка. */
export function ViewToggle(props: {
  kind: ListKind;
  onChange: (kind: ListKind) => void;
}) {
  const mobile = useMobile();
  if (mobile) return null;
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

/** Канбан-доска только для просмотра: колонки — статусы экрана, клик по карточке открывает её.
 *  Доска не прокручивается сама: колонки идут одной горизонтальной линией, а если они
 *  не помещаются, страницу прокручивает браузер (решение пользователя 23.10.2026). */
export function BoardView<T>(props: {
  columns: BoardColumn[];
  rows: T[];
  stateOf: (row: T) => string;
  renderCard: (row: T) => ReactNode;
  onOpen?: (row: T) => void;
  /** Идентификатор уже открытой карточки — она выделяется на доске, пока открыта шторка. */
  selectedId?: string | null;
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
    flex: "1 1 250px",
    minWidth: 220,
    maxWidth: 340,
    background: token.colorFillQuaternary,
    borderRadius: token.borderRadiusLG,
    padding: token.paddingSM,
  };
  const card = (row: T) => {
    const id = String((row as { id?: unknown }).id);
    const openable = !!props.onOpen;
    const selected = openable && props.selectedId != null &&
      id === String(props.selectedId);
    // Цвета состояний — из токенов темы; сами состояния (hover, нажатие,
    // фокус с клавиатуры, выделение) описаны в board.css.
    const vars = {
      "--board-card-bg": selected
        ? token.colorPrimaryBg
        : token.colorBgContainer,
      "--board-card-border": selected
        ? token.colorPrimary
        : token.colorBorderSecondary,
      "--board-card-border-hover": token.colorPrimaryBorderHover,
      "--board-card-focus": token.colorPrimary,
      "--board-card-radius": token.borderRadiusLG,
      "--board-card-shadow": selected
        ? `0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px ${token.colorPrimaryBorder}`
        : "0 2px 8px rgba(0, 0, 0, 0.12)",
    } as CSSProperties;
    return (
      <div
        key={id}
        role={openable ? "button" : undefined}
        tabIndex={openable ? 0 : undefined}
        aria-pressed={selected ? true : undefined}
        className={
          openable
            ? selected
              ? "board-card board-card--clickable board-card--selected"
              : "board-card board-card--clickable"
            : "board-card"
        }
        onClick={openable ? () => props.onOpen!(row) : undefined}
        onKeyDown={
          openable
            ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                props.onOpen!(row);
              }
            }
            : undefined
        }
        style={{ ...vars, padding: token.paddingSM }}
      >
        {props.renderCard(row)}
        {openable && <span className="board-card__hint" aria-hidden>→</span>}
      </div>
    );
  };
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
        flexWrap: "nowrap",
        gap: token.marginSM,
        alignItems: "flex-start",
        boxSizing: "border-box",
        // На телефоне колонок больше, чем ширины экрана: доска прокручивается
        // внутри контейнера, а не растягивает страницу.
        overflowX: "auto",
        paddingTop: 2,
        paddingBottom: token.marginSM,
      }}
    >
      {props.columns.map((c) =>
        column(c.value, c.label, grouped.get(c.value) ?? [])
      )}
      {other.length > 0 && column("__other", "Прочее", other)}
    </div>
  );
}
