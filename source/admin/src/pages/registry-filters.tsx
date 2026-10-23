import { Input, Select, Space } from "antd";

export type RegistrySection = "buildings" | "premises" | "connections";
export type RegistryRow = Record<string, unknown>;
export type PhaseFilter = number | "all" | "unassigned";
export const PHASE_OPTIONS = [
  { value: "all", label: "Все очереди" },
  ...[1, 2, 3, 4, 5].map(value => ({ value, label: `${value}-я очередь` })),
  { value: "unassigned", label: "Не указана" },
];
export interface RegistryFilterValues {
  search: string;
  phase: PhaseFilter;
  building?: string;
  kind?: string;
  status?: string;
  role?: string;
}
export const EMPTY_REGISTRY_FILTERS: RegistryFilterValues = { search: "", phase: "all" };
export function matchesPhase(value: unknown, phase: PhaseFilter) {
  return phase === "all" || (phase === "unassigned" ? value == null : value === phase);
}

export function filterRegistryRows(rows: RegistryRow[], filters: RegistryFilterValues,
  kinds: { value: string; label: string }[], roles: { value: string; label: string }[], statuses: Record<string, string>) {
  const search = filters.search.trim().toLocaleLowerCase("ru-RU");
  return rows.filter(row => {
    const searchable = [row.code, row.name, row.building_code, row.building_name,
      row.number, row.full_name, row.phone_e164, row.entrance, row.floor, row.basis,
      kinds.find(kind => kind.value === row.kind)?.label,
      roles.find(role => role.value === row.role)?.label,
      statuses[String(row.status)], row.construction_phase == null ? "Не указана" : `${row.construction_phase}-я очередь`,
    ].join(" ").toLocaleLowerCase("ru-RU");
    return (!search || searchable.includes(search)) && matchesPhase(row.construction_phase, filters.phase)
      && (!filters.building || row.building_id === filters.building)
      && (!filters.kind || row.kind === filters.kind)
      && (!filters.status || row.status === filters.status)
      && (!filters.role || row.role === filters.role);
  });
}

export function RegistryFilters({ section, values, onChange, buildings, kinds, roles, statuses }: {
  section: RegistrySection; values: RegistryFilterValues; onChange: (values: RegistryFilterValues) => void;
  buildings: RegistryRow[]; kinds: { value: string; label: string }[];
  roles: { value: string; label: string }[]; statuses: Record<string, string>;
}) {
  const update = (patch: Partial<RegistryFilterValues>) => onChange({ ...values, ...patch });
  return <Space wrap>
    <Input.Search aria-label="Поиск объектов" allowClear value={values.search}
      placeholder={section === "buildings" ? "Обозначение или название здания" : section === "premises" ? "Здание, номер, подъезд или этаж" : "ФИО, телефон, здание или помещение"}
      onChange={event => update({ search: event.target.value })} style={{ width: 300, maxWidth: "100%" }} />
    <Select aria-label="Фильтр по очереди строительства" value={values.phase}
      onChange={phase => update({ phase })} options={PHASE_OPTIONS} style={{ width: 180 }} />
    {section !== "buildings" && <>
      <Select aria-label="Фильтр по зданию" placeholder="Все здания" allowClear showSearch optionFilterProp="label"
        value={values.building} onChange={building => update({ building })} style={{ width: 220 }}
        options={buildings.map(b => ({ value: String(b.id), label: [b.code, b.name].filter(Boolean).join(" · ") }))} />
      <Select aria-label="Фильтр по типу помещения" placeholder="Все типы" allowClear value={values.kind}
        onChange={kind => update({ kind })} options={kinds} style={{ width: 220 }} />
      <Select aria-label="Фильтр по статусу" placeholder="Все статусы" allowClear value={values.status}
        onChange={status => update({ status })} style={{ width: 190 }}
        options={Object.entries(statuses).map(([value, label]) => ({ value, label }))} />
    </>}
    {section === "connections" && <Select aria-label="Фильтр по отношению к помещению" placeholder="Все отношения" allowClear
      value={values.role} onChange={role => update({ role })} options={roles} style={{ width: 250 }} />}
  </Space>;
}
