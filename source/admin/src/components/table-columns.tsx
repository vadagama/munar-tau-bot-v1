import { useState } from "react";
import { Button, Checkbox, Popover, Space } from "antd";
import type { TableColumnsType } from "antd";

/** Сохраняем скрытые колонки: новые колонки после обновления видны по умолчанию. */
export function useTableColumns<T extends object>(storageKey: string, columns: TableColumnsType<T>) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string" && key !== "number") : [];
    } catch {
      return [];
    }
  });
  const change = (next: string[]) => {
    setHidden(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {
      // В приватном режиме настройка действует до перезагрузки страницы.
    }
  };
  const settings = <Popover trigger="click" placement="bottomRight" content={
    <Space direction="vertical" role="group" aria-label="Видимые колонки">
      {columns.map(column => <Checkbox
        key={String(column.key)}
        checked={!hidden.includes(String(column.key))}
        disabled={column.key === "number"}
        onChange={event => change(event.target.checked
          ? hidden.filter(key => key !== column.key)
          : [...hidden, String(column.key)])}
      >{typeof column.title === "string" ? column.title : String(column.key)}</Checkbox>)}
      <Button size="small" onClick={() => change([])}>Все колонки</Button>
    </Space>
  }><Button>Колонки</Button></Popover>;
  return { columns: columns.filter(column => !hidden.includes(String(column.key))), settings };
}
