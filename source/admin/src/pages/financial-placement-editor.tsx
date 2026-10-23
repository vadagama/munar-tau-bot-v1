import { useEffect, useRef, useState } from "react";
import { Alert, Button, DatePicker, Form, Input, Select, Spin, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { financialPlacementValues } from "./financial-placement-values";
import { isVersionConflict } from "./version-conflict";
import type { DocumentVersionOption } from "./financial-package-fields";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
export function FinancialPlacementEditor(props: { duty: Row; onCancel: () => void; onSaved: (result: Row) => void }) {
  const [form] = Form.useForm(), selected = Form.useWatch("financial_version_id", form);
  const [current, setCurrent] = useState(props.duty), [publication, setPublication] = useState<Row | null>(null), [proofs, setProofs] = useState<DocumentVersionOption[]>([]), [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), key = useRef(crypto.randomUUID()), intent = useRef(""), offset = useRef(0);
  async function load() {
    const g = ++generation.current; setLoading(true); setReady(false); setError(null);
    try {
      const duty = conflict ? await apiFetch<Row>(`/v1/financial-obligations/${props.duty.id}`) : props.duty;
      if (g !== generation.current) return;
      if (conflict && duty.can_manage !== true) throw new Error("Обязанность недоступна для изменения");
      if (!duty.publication_id) throw new Error("Сначала выпустите финансовый комплект");
      const [p, versions] = await Promise.all([apiFetch<Row>(`/v1/publications/${duty.publication_id}`), apiFetch<{ items: DocumentVersionOption[]; has_more: boolean }>("/v1/documents/version-options")]);
      if (g === generation.current) { setCurrent(duty); setPublication(p); setProofs(versions.items); setMore(versions.has_more); offset.current = 0; setConflict(false); setReady(true); if (conflict) setError("Данные обновлены. Проверьте версию выпуска перед повторным подтверждением; ваш ввод сохранён."); }
    } catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : "Не удалось прочитать данные размещения"); }
    finally { if (g === generation.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  async function moreProofs() {
    const g = generation.current; setBusy(true);
    try { const result = await apiFetch<{ items: DocumentVersionOption[]; has_more: boolean }>(`/v1/documents/version-options?offset=${offset.current + 200}`); if (g === generation.current) { setProofs(old => [...old, ...result.items]); setMore(result.has_more); offset.current += 200; } }
    catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : "Не удалось загрузить документы"); }
    finally { if (g === generation.current) setBusy(false); }
  }
  const released = ((publication?.financial_versions as Row[]) ?? []).filter(v => !!v.published_at);
  const channels = ((current.rule_snapshot as Row)?.definition as Row)?.channels as string[] ?? [];
  async function save() {
    if (!ready || busy || conflict) return;
    let body: Row;
    try {
      const values = await form.validateFields();
      if (!released.some(v => v.id === values.financial_version_id)) throw new Error("Выберите выпущенную версию отчёта");
      body = financialPlacementValues(values, current.version);
    } catch (e) { if (e instanceof Error) setError(e.message); return; }
    const fingerprint = JSON.stringify(body);
    if (intent.current && fingerprint !== intent.current) key.current = crypto.randomUUID(); intent.current = fingerprint;
    const g = generation.current; setBusy(true); setError(null);
    try { const result = await apiFetch<Row>(`/v1/financial-obligations/${current.id}/placements`, { method: "POST", body, idempotencyKey: key.current }); if (g === generation.current) props.onSaved(result); }
    catch (e) { if (g === generation.current) { setConflict(isVersionConflict(e)); setError(isVersionConflict(e) ? "Обязанность изменена. Обновите данные размещения; ваш ввод сохранён." : e instanceof Error ? e.message : "Не удалось подтвердить размещение"); } }
    finally { if (g === generation.current) setBusy(false); }
  }
  return <ActionPanel open title="Подтвердить размещение" form={form} busy={busy || loading} error={error} onCancel={props.onCancel}>
    <Typography.Paragraph>Укажите фактическое размещение в обязательном канале. Отправка уведомления ботом не является доказательством размещения.</Typography.Paragraph>
    {loading && <Spin aria-label="Загрузка выпуска" />}
    {!loading && (!ready || conflict) && <Button onClick={() => void load()}>Обновить данные размещения</Button>}
    {ready && !released.length && <Alert type="info" message="У обязанности ещё нет выпущенного финансового комплекта" />}
    {selected && (selected !== publication?.financial_version_id || selected !== current.active_version_id) && <Alert type="warning" showIcon message="Размещение исторической версии сохраняется в истории и не закрывает текущую обязанность." />}
    <Form form={form} layout="vertical" disabled={!ready || busy || conflict}>
      <Form.Item name="financial_version_id" label="Выпущенная версия отчёта" rules={required}><Select options={released.map(v => ({ value: v.id, label: `Версия ${v.version}` }))} /></Form.Item>
      <Form.Item name="channel" label="Канал размещения" rules={required}><Select options={channels.map(value => ({ value, label: value }))} /></Form.Item>
      <Form.Item name="placed_at" label="Фактическая дата и время размещения (Алматы)" rules={required}><DatePicker showTime format="DD.MM.YYYY HH:mm" /></Form.Item>
      <Form.Item name="evidence" label="Доказательство размещения" rules={required}><Input.TextArea placeholder="Где размещено и как проверено" /></Form.Item>
      <Form.Item name="proof_version_id" label="Документ-доказательство (необязательно)"><Select allowClear showSearch optionFilterProp="label" options={proofs.map(v => ({ value: v.id, label: `${v.title} · версия ${v.version}` }))} /></Form.Item>
      {more && <Button onClick={() => void moreProofs()}>Ещё документы-доказательства</Button>}
      <Form.Item name="reason" label="Служебная причина" rules={required}><Input.TextArea /></Form.Item>
    </Form>
    <Button type="primary" disabled={!ready || conflict || !released.length} loading={busy} onClick={() => void save()}>Подтвердить размещение</Button>
  </ActionPanel>;
}
