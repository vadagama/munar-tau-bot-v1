import { useState, type ReactNode } from "react";
import { Button, Drawer, Input, Select, Space, Tag } from "antd";
import { CloseOutlined, FilterOutlined } from "@ant-design/icons";
import { useMobile } from "../lib/use-mobile";

export type FilterValues = { state?: string; related?: string; from: string; to: string };
type Option = { value: string; label: string };

/** На телефоне редактируем черновик; на широком экране сохраняем мгновенные фильтры. */
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const current = mobile ? draft : values;
  const change = (patch: Partial<FilterValues>) => {
    const next = { ...current, ...patch };
    if (mobile) setDraft(next); else onChange(next);
  };
  const fields = <>
    <Select aria-label={relatedLabel} placeholder={relatedLabel} allowClear showSearch optionFilterProp="label"
      value={current.related} onChange={related => change({ related })} options={relatedOptions} style={{ width: 240 }} />
    <Select aria-label={stateLabel} placeholder={stateLabel} allowClear
      value={current.state} onChange={state => change({ state })} options={stateOptions} style={{ width: 230 }} />
    <label className="list-filter-date">Дата создания с
      <Input aria-label={dateLabels[0]} type="date" value={current.from} onChange={e => change({ from: e.target.value })} />
    </label>
    <label className="list-filter-date">Дата создания по
      <Input aria-label={dateLabels[1]} type="date" value={current.to} onChange={e => change({ to: e.target.value })} />
    </label>
  </>;
  if (!mobile) return <Space wrap>{search}{fields}</Space>;
  const active = [
    { key: "related" as const, value: values.related, label: relatedOptions.find(o => o.value === values.related)?.label ?? values.related },
    { key: "state" as const, value: values.state, label: stateOptions.find(o => o.value === values.state)?.label ?? values.state },
    { key: "from" as const, value: values.from, label: `С ${values.from}` },
    { key: "to" as const, value: values.to, label: `По ${values.to}` },
  ].filter(item => !!item.value);
  return <div className="mobile-filters">
    <div className="mobile-filters__bar">
      {search}
      <Button icon={<FilterOutlined aria-hidden />} onClick={() => { setDraft(values); setOpen(true); }}>
        Фильтры{active.length ? ` · ${active.length}` : ""}
      </Button>
    </div>
    {!!active.length && <div className="mobile-filters__tags" aria-label="Активные фильтры">
      {active.map(item => <Tag key={item.key}>
        {item.label}<Button type="text" size="small" icon={<CloseOutlined aria-hidden />} aria-label={`Убрать фильтр: ${item.label}`}
          onClick={() => onChange({ ...values, [item.key]: item.key === "from" || item.key === "to" ? "" : undefined })} />
      </Tag>)}
    </div>}
    <Drawer title="Фильтры" placement="bottom" height="min(580px, 90dvh)" open={open} onClose={() => setOpen(false)}
      footer={<div className="mobile-filters__footer">
        <Button onClick={() => { const empty = { from: "", to: "" }; setDraft(empty); onChange(empty); setOpen(false); }}>Сбросить</Button>
        <Button type="primary" disabled={!!draft.from && !!draft.to && draft.from > draft.to}
          onClick={() => { onChange(draft); setOpen(false); }}>Применить</Button>
      </div>}>
      <div className="mobile-filters__fields">{fields}</div>
      {!!draft.from && !!draft.to && draft.from > draft.to && <p role="alert">Дата начала периода позже даты окончания</p>}
    </Drawer>
  </div>;
}
