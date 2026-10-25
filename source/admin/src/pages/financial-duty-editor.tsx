import { useEffect, useRef, useState } from "react";
import { Alert, Button, DatePicker, Form, Input, Select, Spin, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { FinancialRuleDetails } from "./financial-rule-details";
import { FinancialStaffFields } from "./financial-staff-fields";
import { isVersionConflict } from "./version-conflict";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
export function FinancialDutyEditor(props: { duty: Row | null; onCancel: () => void; onSaved: () => void }) {
  const [form] = Form.useForm(), ruleId = Form.useWatch("rule_id", form);
  const [rules, setRules] = useState<Row[]>([]), [people, setPeople] = useState<Row[]>([]), [current, setCurrent] = useState(props.duty);
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState(false);
  const generation = useRef(0), intent = useRef(""), key = useRef(crypto.randomUUID());
  const rule = rules.find(r => r.id === ruleId);
  async function load() {
    const g = ++generation.current; setLoading(true); setReady(false); setError(null);
    try {
      if (props.duty) {
        const [p, duty] = await Promise.all([apiFetch<{ items: Row[] }>("/v1/documents/candidates"), conflict ? apiFetch<Row>(`/v1/financial-obligations/${props.duty.id}`) : Promise.resolve(props.duty)]);
        if (g !== generation.current) return;
        if (conflict && (duty.can_manage !== true || duty.completed_at)) throw new Error("Обязанность больше недоступна для передачи");
        setPeople(p.items); setCurrent(duty);
      } else {
        const result = await apiFetch<{ items: Row[] }>("/v1/financial-rules");
        if (g !== generation.current) return;
        setRules(result.items.filter(r => r.active === true && r.can_manage === true));
      }
      if (g === generation.current) { setReady(true); setConflict(false); if (conflict) setError("Актуальная версия загружена. Проверьте условия перед повторным сохранением; ваш ввод сохранён."); }
    } catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : "Не удалось загрузить условия"); }
    finally { if (g === generation.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  async function save() {
    if (!ready || busy || conflict || !props.duty && !rule) return;
    let values: Row; try { values = await form.validateFields(); } catch { return; }
    const body = props.duty ? { ...values, expected_version: current!.version } : { reason: values.reason, rule_id: rule!.id, expected_version: rule!.version, period_from: (values.period_from as Dayjs).format("YYYY-MM-DD"), period_to: (values.period_to as Dayjs).format("YYYY-MM-DD") };
    const fingerprint = JSON.stringify(body);
    if (intent.current && fingerprint !== intent.current) key.current = crypto.randomUUID(); intent.current = fingerprint;
    const g = generation.current; setBusy(true); setError(null);
    try {
      await apiFetch(props.duty ? `/v1/financial-obligations/${props.duty.id}/reassign` : "/v1/financial-obligations", { method: "POST", body, idempotencyKey: key.current });
      if (g === generation.current) props.onSaved();
    } catch (e) { if (g === generation.current) { setConflict(isVersionConflict(e)); setError(isVersionConflict(e) ? "Условия изменены. Обновите исходную версию; ваш ввод сохранён." : e instanceof Error ? e.message : "Не удалось сохранить обязанность"); } }
    finally { if (g === generation.current) setBusy(false); }
  }
  return <ActionPanel open title={props.duty ? "Передать финансовую обязанность" : "Новая финансовая обязанность"} form={form} busy={busy || loading} error={error} onCancel={props.onCancel}>
    <Typography.Paragraph>{props.duty ? "Передача меняет ответственных и сохраняет первоначальный срок и исходный регламент." : "Срок рассчитывается по действующему регламенту времени от конца отчётного периода. Условия фиксируются в обязанности."}</Typography.Paragraph>
    {!props.duty && <Typography.Link href="/time-rules" target="_blank" rel="noreferrer">Регламенты времени</Typography.Link>}
    {loading && <Spin aria-label="Загрузка условий" />}
    {!loading && (!ready || conflict) && <Button onClick={() => void load()}>Сравнить актуальную версию</Button>}
    {!props.duty && ready && !rules.length && <Alert type="info" message="Нет действующих финансовых регламентов с правом управления" />}
    {rule && <FinancialRuleDetails rule={rule} />}
    {props.duty && current !== props.duty && <Alert type="info" message={`Актуальная версия обязанности: ${current?.version}`} description={`Подготовитель: ${current?.prepared_name ?? "—"}. Проверяющий: ${current?.reviewer_name ?? "—"}. Публикатор: ${current?.publisher_name ?? "—"}.`} />}
    <Form form={form} layout="vertical" disabled={!ready || busy || conflict} initialValues={props.duty ? { prepared_by: props.duty.prepared_by, reviewer_id: props.duty.reviewer_id, publisher_id: props.duty.publisher_id } : {}}>
      {props.duty ? <FinancialStaffFields people={people} current={current} /> : <>
        <Form.Item name="rule_id" label="Финансовый регламент" rules={required}><Select options={rules.map(r => ({ value: r.id, label: `${r.name} · версия ${r.version}` }))} /></Form.Item>
        <Form.Item name="period_from" label="Начало периода" rules={required}><DatePicker format="DD.MM.YYYY" /></Form.Item>
        <Form.Item name="period_to" label="Конец периода" rules={required}><DatePicker format="DD.MM.YYYY" /></Form.Item>
      </>}
      <Form.Item name="reason" label="Служебная причина" rules={required}><Input.TextArea /></Form.Item>
    </Form>
    <Button type="primary" disabled={!ready || conflict || !props.duty && !rule} loading={busy} onClick={() => void save()}>{props.duty ? "Сохранить ответственных" : "Создать обязанность"}</Button>
  </ActionPanel>;
}
