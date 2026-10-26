import { FilterOutlined } from "@ant-design/icons";
import { PageSearch } from "../components/page-controls";
import { useEffect, useRef, useState } from "react";
import { CardDrawer } from "./card-drawer";
import { Alert, Button, Descriptions, Select, Space } from "antd";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { apiFetch } from "../lib/api";
import { matchesPhase, PHASE_OPTIONS, type PhaseFilter, type RegistryRow } from "./registry-filters";

export function summarizePhases(buildings: RegistryRow[], premises: RegistryRow[]) {
  return [1, 2, 3, 4, 5, null].map(phase => {
    const members = buildings.filter(building => (building.construction_phase ?? null) === phase);
    const ids = new Set(members.map(building => building.id));
    return {
      id: phase ?? "unassigned", phase,
      name: phase == null ? "Не указана" : `${phase}-я очередь`,
      buildings: members.map(building => building.name || building.code).join(", ") || "Нет зданий",
      building_count: members.length,
      premises_count: premises.filter(premise => ids.has(premise.building_id)).length,
    };
  });
}

export function RegistryPhasesPage() {
  const [selected, setSelected] = useState<ReturnType<typeof summarizePhases>[number] | null>(null);
  const [buildings, setBuildings] = useState<RegistryRow[]>([]);
  const [premises, setPremises] = useState<RegistryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [occupancy, setOccupancy] = useState<string>();
  const [page, setPage] = useState(1);
  const generation = useRef(0);
  const load = async () => {
    const current = ++generation.current;
    setBusy(true);
    setError(undefined);
    try {
      const [b, p] = await Promise.all([
        apiFetch<{ items: RegistryRow[] }>("/v1/registry/buildings"),
        apiFetch<{ items: RegistryRow[] }>("/v1/registry/premises"),
      ]);
      if (current !== generation.current) return;
      setBuildings(b.items);
      setPremises(p.items);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  usePageRefresh(load, !busy);
  const query = search.trim().toLocaleLowerCase("ru-RU");
  const rows = summarizePhases(buildings, premises).filter(row =>
    matchesPhase(row.phase, phase) && (!query || `${row.name} ${row.buildings}`.toLocaleLowerCase("ru-RU").includes(query))
      && (!occupancy || (occupancy === "filled" ? row.building_count > 0 : row.building_count === 0)),
  );
  return <PageLayout title="Очереди" filters={<Space wrap>
    <PageSearch aria-label="Поиск очередей" allowClear placeholder="Очередь, здание или адрес" value={search}
      onChange={event => { setSearch(event.target.value); setPage(1); }} style={{ width: 300, maxWidth: "100%" }} />
    <Select prefix={<FilterOutlined aria-hidden />} aria-label="Фильтр по очереди строительства" value={phase} options={PHASE_OPTIONS}
      onChange={value => { setPhase(value); setPage(1); }} style={{ width: 180 }} />
    <Select prefix={<FilterOutlined aria-hidden />} aria-label="Наличие зданий" allowClear placeholder="Все очереди по составу" value={occupancy}
      onChange={value => { setOccupancy(value); setPage(1); }} style={{ width: 230 }}
      options={[{ value: "filled", label: "Есть здания" }, { value: "empty", label: "Без зданий" }]} />
  </Space>}>

    {error && <Alert type="error" showIcon message={error} />}
    <ConfigurableTable storageKey="columns.registry.phases" onMobileRowClick={row => setSelected(row)} settingsPlacement="page" rowKey="id" loading={busy}
      dataSource={error && !buildings.length ? [] : rows} scroll={{ x: 800 }} pagination={{ current: page, onChange: setPage, pageSize: 20 }}
      locale={{ emptyText: error ? "Данные не загружены" : "По выбранным условиям ничего не найдено" }} columns={[
        { title: "Очередь", dataIndex: "name", render: (name, row) => <Button type="link" onClick={() => setSelected(row)}>{name}</Button> },
        { title: "Помещений", dataIndex: "premises_count" },
      ]} />
    <CardDrawer open={!!selected} title={selected?.name} onClose={() => setSelected(null)}>
      {selected && <Descriptions column={1} layout="vertical" items={[
        {key:"buildings",label:"Состав зданий",children:selected.buildings},
        {key:"count",label:"Зданий",children:selected.building_count},
        {key:"premises",label:"Помещений",children:selected.premises_count},
      ]} />}
    </CardDrawer>
  </PageLayout>;
}
