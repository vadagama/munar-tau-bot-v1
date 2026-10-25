import { SortAscendingOutlined } from "@ant-design/icons";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Select, Table, type TableProps } from "antd";
import { useMobile } from "../lib/use-mobile";
import { FilterSortSummary, PageControlsContext } from "./page-controls";
import { TableSettingsContext } from "./table-settings-context";
import { withColumnSorting } from "./table-sorting";
import { useTableColumns, type ConfigurableColumn } from "./table-columns";

type Props<T extends object> = Omit<TableProps<T>, "columns"> & {
  storageKey: string;
  mobileSortPlacement?: "page" | "inline" | "none";
  mobileRender?: (record: T) => ReactNode;
  settingsPlacement?: "page" | "inline";
  columns?: ConfigurableColumn<T>[];
};

/** Ключ настроек меняется вместе с видом реестра, не смешивая скрытые поля. */
export function ConfigurableTable<T extends object>(props: Props<T>) {
  return <ConfiguredTable key={props.storageKey} {...props} />;
}

function ConfiguredTable<T extends object>({ storageKey, settingsPlacement = "inline", columns = [], mobileRender, mobileSortPlacement = "page", ...props }: Props<T>) {
  const mobile = useMobile();
  const [sort, setSort] = useState<string>();
  const host = useContext(TableSettingsContext);
  const controls = useContext(PageControlsContext);
  const registerSort = controls?.registerSort;
  const register = host?.register;
  const pageSettings = settingsPlacement === "page" && !!host && !mobile;
  useEffect(() => {
    if (pageSettings && register) return register();
  }, [pageSettings, register]);
  const keyedColumns = columns.map((column, index) => {
    const dataIndex = "dataIndex" in column ? column.dataIndex : undefined;
    const key = column.key ?? (Array.isArray(dataIndex) ? dataIndex.join(".") : dataIndex)
      ?? (typeof column.title === "string" ? column.title || "actions" : `column-${index}`);
    const keyed = { ...column, key: String(key) };
    return "children" in keyed ? keyed : withColumnSorting<T>(keyed);
  });
  const configured = useTableColumns<T>(storageKey, keyedColumns);
  // Та же Table сохраняет пагинацию, загрузку, пустое состояние и обработчики строк.
  // Мобильная запись не зависит от скрытых пользователем настольных колонок.
  const [sortIndex, direction] = sort?.split(":") ?? [];
  const selectedSort = sortIndex === undefined ? undefined : keyedColumns[Number(sortIndex)];
  const sorter = selectedSort && "sorter" in selectedSort ? selectedSort.sorter : undefined;
  const sortOptions = keyedColumns.flatMap((column, index) => "sorter" in column && column.sorter && typeof column.title === "string"
    ? [{value:`${index}:ascend`,label:`${column.title} ↑`}, {value:`${index}:descend`,label:`${column.title} ↓`}] : []);
  const pageSort = mobile && mobileSortPlacement === "page" && !!controls && sortOptions.length > 0;
  useEffect(() => {
    if (pageSort && registerSort) return registerSort();
  }, [pageSort, registerSort]);
  const sorting = mobileSortPlacement !== "none" && !!sortOptions.length && <Select prefix={<SortAscendingOutlined aria-hidden />} className="mobile-sort" aria-label="Сортировка списка" placeholder="Сортировка" allowClear
    value={sort} onChange={next => {
      setSort(next);
      if (props.pagination) props.pagination.onChange?.(1, props.pagination.pageSize ?? props.pagination.defaultPageSize ?? 10);
    }} options={sortOptions} />;
  if (mobile) return <>
    {pageSort ? controls.sortTarget && createPortal(sorting, controls.sortTarget)
      : sorting && <details className="cabinet-page__compact-filters"><FilterSortSummary />{sorting}</details>}
    <Table<T> key={sort ?? "default"} {...props} className={`mobile-records ${props.className ?? ""}`}
    scroll={undefined} showHeader={false} tableLayout="auto"
    columns={[{ key: selectedSort?.key ?? "record", sorter, sortOrder: sort ? (direction === "descend" ? "descend" : "ascend") : null, render: (_, record, index) => mobileRender ? mobileRender(record) :
      <dl className="mobile-record-fields">{columns.map((column, i) => {
        if ("children" in column || column.defaultHidden) return null;
        const path = column.dataIndex == null ? [] : Array.isArray(column.dataIndex) ? column.dataIndex : [column.dataIndex];
        const value = path.reduce<unknown>((current, key) => current == null ? undefined : (current as Record<string, unknown>)[String(key)], record);
        const rendered = column.render ? column.render(value, record, index) : value;
        const content = rendered && typeof rendered === "object" && "children" in rendered && "props" in rendered
          ? rendered.children : rendered;
        return <div key={String(column.key ?? i)}>
          {typeof column.title === "string" && column.title && <dt>{column.title}</dt>}
          <dd>{content as ReactNode ?? "—"}</dd>
        </div>;
      })}</dl> }]} />
  </>;
  return <>
    {pageSettings
      ? host.target && createPortal(configured.settings, host.target)
      : <div className="table-settings-toolbar">{configured.settings}</div>}
    <Table<T> {...props} columns={configured.columns} />
  </>;
}
