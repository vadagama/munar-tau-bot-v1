import { SettingOutlined } from "@ant-design/icons";
import { useState } from "react";
import { Button, Checkbox, Popover, Space } from "antd";
import type { TableColumnsType } from "antd";

/** Колонка с флагом «скрыта по умолчанию» (новые пользователи её не видят). */
export type ConfigurableColumn<T> = TableColumnsType<T>[number] & {
  defaultHidden?: boolean;
};

type SavedSettings = { v: 2; hidden: string[] };

/** Скрытые колонки экрана: сохранённый выбор пользователя, иначе — defaultHidden. */
function readHidden<T extends object>(
  storageKey: string,
  columns: TableColumnsType<T>,
  primaryKey: string,
): string[] {
  const defaults = columns
    .filter((column) => (column as ConfigurableColumn<T>).defaultHidden === true)
    .map((column) => String(column.key))
    .filter((key) => key !== primaryKey);
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (Array.isArray(saved)) {
      // Формат до появления скрытых по умолчанию колонок: сохранённый список
      // не мог учитывать новые ключи, поэтому объединяем с умолчанием.
      return Array.from(new Set([
        ...saved.filter((key): key is string => typeof key === "string" && key !== primaryKey),
        ...defaults,
      ]));
    }
    if (
      saved && typeof saved === "object" &&
      Array.isArray((saved as SavedSettings).hidden)
    ) {
      return (saved as SavedSettings).hidden
        .filter((key): key is string => typeof key === "string" && key !== primaryKey);
    }
    return defaults;
  } catch {
    return defaults;
  }
}

/** Сохраняем скрытые колонки: новый выбор пользователя пишется в формате v2. */
export function useTableColumns<T extends object>(storageKey: string, columns: TableColumnsType<T>) {
  const primaryKey = String(columns[0]?.key ?? "");
  const [hidden, setHidden] = useState<string[]>(() =>
    readHidden(storageKey, columns, primaryKey),
  );
  const change = (next: string[]) => {
    setHidden(next);
    try {
      const saved: SavedSettings = { v: 2, hidden: next };
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // В приватном режиме настройка действует до перезагрузки страницы.
    }
  };
  const settings = <Popover trigger="click" placement="bottomRight" content={
    <Space direction="vertical" role="group" aria-label="Видимые колонки">
      {columns.map(column => <Checkbox
        key={String(column.key)}
        checked={!hidden.includes(String(column.key))}
        disabled={String(column.key) === primaryKey}
        onChange={event => change(event.target.checked
          ? hidden.filter(key => key !== column.key)
          : [...hidden, String(column.key)])}
      >{typeof column.title === "string" ? column.title || "Действия" : String(column.key)}</Checkbox>)}
      <Button size="small" onClick={() => change([])}>Все колонки</Button>
    </Space>
  }><Button aria-label="Колонки" title="Настройка колонок" icon={<SettingOutlined />} /></Popover>;
  return { columns: columns.filter(column => !hidden.includes(String(column.key))), settings };
}
