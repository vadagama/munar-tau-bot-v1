import { useCallback, useEffect, useRef, useState } from "react";
import { Select, Space, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { EMULATION_ROLE_LABELS } from "../lib/emulation-roles";
import type { EmulationPersonJson, EmulationPersonsResponse } from "../lib/types";
import { usePageRefresh } from "../lib/use-page-refresh";

/** Быстрая смена тестовой персоны через обычный, проверяемый сервером сеанс. */
export function EmulationRoleSelect({ profileId, onSwitched }: {
  profileId: string;
  onSwitched: () => void;
}) {
  const [persons, setPersons] = useState<EmulationPersonJson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const result = await apiFetch<EmulationPersonsResponse>("/v1/emulation/persons");
      setPersons(result.persons);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить роли эмуляции");
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePageRefresh(load, !loading && !busy);

  const grouped = new Map<string, { value: string; label: string; profileId: string; disabled: boolean }[]>();
  for (const person of persons) {
    const roles = person.assignments.length ? [...new Set(person.assignments.map(a => a.role))] : ["resident"];
    for (const role of roles) {
      const label = EMULATION_ROLE_LABELS[role] ?? role;
      const options = grouped.get(role) ?? [];
      options.push({ value: `${role}:${person.profile.id}`, label: `${label} — ${person.person.full_name}`,
        profileId: person.profile.id, disabled: person.profile.id === profileId });
      grouped.set(role, options);
    }
  }
  const options = [...grouped].map(([role, options]) => ({ label: EMULATION_ROLE_LABELS[role] ?? role, options }));
  const entries = options.flatMap(group => group.options);
  const selected = entries.find(option => option.profileId === profileId)?.value;
  const switchPerson = async (value: string) => {
    const target = entries.find(option => option.value === value);
    if (!target || target.profileId === profileId || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/v1/emulation/sessions", { method: "POST", body: { emulated_profile_id: target.profileId } });
      onSwitched();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переключить эмуляцию");
      pending.current = false;
      setBusy(false);
    }
  };
  return <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
    <Select aria-label="Роль эмуляции" size="small" placeholder="Роль эмуляции"
      value={selected} options={options} loading={loading || busy} disabled={loading || busy}
      style={{ width: 240, maxWidth: "100%" }} onChange={value => void switchPerson(value)}
      notFoundContent="Нет тестовых персон" />
    {error && <Typography.Text type="danger" role="alert" style={{ whiteSpace: "normal" }}>{error}</Typography.Text>}
  </Space>;
}
