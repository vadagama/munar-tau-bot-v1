import { FilterOutlined } from "@ant-design/icons";
import { type ReactNode } from "react";
import { Button, Input, Select, Space } from "antd";
import { useMobile } from "../lib/use-mobile";

export type FilterValues = { state?: string; related?: string; from: string; to: string };
type Option = { value: string; label: string };

/** Общие поля внутри сворачиваемой области страницы. */
export function ListFilters({ search, values, onChange, stateLabel, stateOptions, relatedLabel, relatedOptions, dateLabels = ["Период с", "Период по"] }: {
  dateLabels?: [string, string];
  search: ReactNode;
  values: FilterValues;
  onChange: (value: FilterValues) => void;
  stateLabel: string;
  stateOptions: Option[];
  relatedLabel: string;
  relatedOptions: Option[];
}) {
  const mobile = useMobile();
  const current = values;
  const change = (patch: Partial<FilterValues>) => onChange({ ...values, ...patch });
  const fields = <>
    <Select prefix={<FilterOutlined aria-hidden />} aria-label={relatedLabel} placeholder={relatedLabel} allowClear showSearch optionFilterProp="label"
      value={current.related} onChange={related => change({ related })} options={relatedOptions} style={{ width: 240 }} />
    <Select prefix={<FilterOutlined aria-hidden />} aria-label={stateLabel} placeholder={stateLabel} allowClear
      value={current.state} onChange={state => change({ state })} options={stateOptions} style={{ width: 230 }} />
    <label className="list-filter-date">Дата создания с
      <Input aria-label={dateLabels[0]} type="date" value={current.from} onChange={e => change({ from: e.target.value })} />
    </label>
    <label className="list-filter-date">Дата создания по
      <Input aria-label={dateLabels[1]} type="date" value={current.to} onChange={e => change({ to: e.target.value })} />
    </label>
  </>;
  if (!mobile) return <Space wrap>{search}{fields}</Space>;
  return <>
    {search}
    <div className="mobile-filters__fields">{fields}</div>
    {!!values.from && !!values.to && values.from > values.to && <p role="alert">Дата начала периода позже даты окончания</p>}
    <Button onClick={() => onChange({ from: "", to: "" })}>Сбросить фильтры</Button>
  </>;
}
