import { useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import { Table, type TableProps } from "antd";
import { TableSettingsContext } from "./table-settings-context";
import { useTableColumns } from "./table-columns";

type Props<T extends object> = TableProps<T> & {
  storageKey: string;
  settingsPlacement?: "page" | "inline";
};

/** Ключ настроек меняется вместе с видом реестра, не смешивая скрытые поля. */
export function ConfigurableTable<T extends object>(props: Props<T>) {
  return <ConfiguredTable key={props.storageKey} {...props} />;
}

function ConfiguredTable<T extends object>({ storageKey, settingsPlacement = "inline", columns = [], ...props }: Props<T>) {
  const host = useContext(TableSettingsContext);
  const register = host?.register;
  const pageSettings = settingsPlacement === "page" && !!host;
  useEffect(() => {
    if (pageSettings && register) return register();
  }, [pageSettings, register]);
  const keyedColumns = columns.map((column, index) => {
    const dataIndex = "dataIndex" in column ? column.dataIndex : undefined;
    const key = column.key ?? (Array.isArray(dataIndex) ? dataIndex.join(".") : dataIndex)
      ?? (typeof column.title === "string" ? column.title || "actions" : `column-${index}`);
    return { ...column, key: String(key) };
  });
  const configured = useTableColumns(storageKey, keyedColumns);
  return <>
    {pageSettings
      ? host.target && createPortal(configured.settings, host.target)
      : <div className="table-settings-toolbar">{configured.settings}</div>}
    <Table<T> {...props} columns={configured.columns} />
  </>;
}
