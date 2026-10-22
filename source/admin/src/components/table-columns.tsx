import { SettingOutlined } from "@ant-design/icons";
import { useState } from "react";
import { Button, Checkbox, Popover, Space } from "antd";
import type { TableColumnsType } from "antd";

/** Сохраняем скрытые колонки: новые колонки после обновления видны по умолчанию. */
export function useTableColumns<T extends object>(storageKey: string, columns: TableColumnsType<T>) {
  const primaryKey = String(columns[0]?.key ?? "");
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string" && key !== primaryKey) : [];
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
