import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Select, Space, Spin, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { isVersionConflict } from "./version-conflict";
import { FinancialRuleDetails, financialDocumentKinds } from "./financial-rule-details";
import { FinancialStaffFields } from "./financial-staff-fields";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
const yesNo = [{ value: true, label: "Да" }, { value: false, label: "Нет" }];
export function FinancialRuleEditor(props: { rule: Row | null; onCancel: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [people, setPeople] = useState<Row[]>([]), [buildings, setBuildings] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), key = useRef(crypto.randomUUID());
  const intent = useRef("");
  const [version, setVersion] = useState(props.rule?.version), [conflict, setConflict] = useState(false), [freshRule, setFreshRule] = useState<Row | null>(null);
  const definition = props.rule?.definition as Row | undefined;
  async function load() {
    const g = ++generation.current; setLoading(true); setReady(false); setError(null);
    try {
      const [p, b] = await Promise.all([apiFetch<{ items: Row[] }>("/v1/documents/candidates"), apiFetch<{ items: Row[] }>("/v1/registry/buildings")]);
      if (g === generation.current) { setPeople(p.items); setBuildings(b.items); setReady(true); }
    } catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : "Не удалось загрузить справочники"); }
    finally { if (g === generation.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  async function refreshVersion() {
    const g = generation.current; setBusy(true);
    try {
      const result = await apiFetch<{ items: Row[] }>("/v1/financial-rules");
      if (g !== generation.current) return;
      const fresh = result.items.find(row => row.id === props.rule?.id && row.can_manage === true);
      if (!fresh) throw new Error("Регламент недоступен для изменения");
      setVersion(fresh.version); setFreshRule(fresh); setConflict(false); setError("Актуальная версия загружена. Сравните её с вашим вводом перед сохранением.");
    } catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : "Не удалось обновить версию"); }
    finally { if (g === generation.current) setBusy(false); }
  }
  async function save() {
    if (!ready || busy || conflict) return;
    let values: Row;
    try { values = await form.validateFields(); } catch { return; }
    const body = { ...values, ...(props.rule ? { expected_version: version } : {}) };
    const fingerprint = JSON.stringify(body);
    if (intent.current && intent.current !== fingerprint) key.current = crypto.randomUUID();
    intent.current = fingerprint;
    const g = generation.current; setBusy(true); setError(null);
    try {
      await apiFetch(props.rule ? `/v1/financial-rules/${props.rule.id}` : "/v1/financial-rules", { method: props.rule ? "PATCH" : "POST", idempotencyKey: key.current, body });
      if (g === generation.current) props.onSaved();
    } catch (e) { if (g === generation.current) { setConflict(isVersionConflict(e)); setError(isVersionConflict(e) ? "Регламент изменён. Загрузите актуальную версию; ваш ввод сохранён." : e instanceof Error ? e.message : "Не удалось сохранить регламент"); } }
    finally { if (g === generation.current) setBusy(false); }
  }
  return <ActionPanel open title={props.rule ? "Изменить финансовый регламент" : "Новый финансовый регламент"} form={form} busy={busy} error={error} onCancel={props.onCancel}>
    <Typography.Paragraph>Изменения действуют для новых обязанностей. Срок размещения задаётся отдельно в регламентах времени.</Typography.Paragraph>
    {loading && <Spin aria-label="Загрузка справочников" />}
    {!loading && !ready && <Button onClick={() => void load()}>Повторить загрузку справочников</Button>}
    {conflict && <Button disabled={busy} onClick={() => void refreshVersion()}>Загрузить актуальную версию</Button>}
    {freshRule && <Alert type="info" showIcon message={`Сохранённый регламент, версия ${freshRule.version}`} description={<FinancialRuleDetails rule={freshRule} buildings={buildings} />} />}
    <Form form={form} layout="vertical" disabled={!ready || busy} initialValues={{ ...definition, active: props.rule?.active ?? true }}>
      <Form.Item name="name" label="Название регламента" rules={required}><Input /></Form.Item>
      <Form.Item name="form" label="Вид отчёта" rules={required}><Select options={[{ value: "monthly", label: "Месячный" }, { value: "annual", label: "Годовой" }]} /></Form.Item>
      <Form.Item name="form_description" label="Внешняя форма и основание" rules={required}><Input.TextArea /></Form.Item>
      <Form.Item name="building_ids" label="Дома" rules={required}><Select mode="multiple" showSearch optionFilterProp="label" options={buildings.map(b => ({ value: b.id, label: String(b.code) }))} /></Form.Item>
      <FinancialStaffFields people={people} current={{ ...props.rule, ...definition }} />
      <Form.Item name="report_signed_required" label="Подписанный экземпляр отчёта обязателен" rules={required}><Select options={yesNo} /></Form.Item>
      <Typography.Title level={5}>Внешние основания</Typography.Title>
      <Form.List name="required_agreements" rules={[{ validator: async (_, value) => { if (!value?.length || value.length > 20) throw new Error("Укажите от 1 до 20 оснований"); } }]}>{(fields, { add, remove }, { errors }) => <>
        {fields.map(field => <div key={field.key}>
          <Form.Item name={[field.name, "code"]} hidden><Input /></Form.Item>
          <Form.Item name={[field.name, "label"]} label={`Основание ${field.name + 1}`} rules={required}><Input /></Form.Item>
          <Form.Item name={[field.name, "kind"]} label={`Вид основания ${field.name + 1}`} rules={required}><Select options={Object.entries(financialDocumentKinds).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name={[field.name, "signed_required"]} label={`Подпись основания ${field.name + 1} обязательна`} rules={required}><Select options={yesNo} /></Form.Item>
          <Button onClick={() => remove(field.name)}>Удалить основание {field.name + 1}</Button>
        </div>)}
        <Form.ErrorList errors={errors} /><Button disabled={!ready || busy || fields.length >= 20} onClick={() => add({ code: `basis_${crypto.randomUUID().replaceAll("-", "")}` })}>Добавить основание</Button>
      </>}</Form.List>
      <Form.Item name="channels" label="Обязательные каналы размещения" extra="Введите название канала и нажмите Enter" rules={required}><Select mode="tags" /></Form.Item>
      <Form.Item name="active" label="Регламент действует" rules={required}><Select options={yesNo} /></Form.Item>
      <Form.Item name="reason" label="Служебная причина" rules={required}><Input.TextArea /></Form.Item>
    </Form>
    <Space><Button type="primary" disabled={!ready || conflict} loading={busy} onClick={() => void save()}>Сохранить регламент</Button></Space>
    {ready && <Alert type="info" showIcon message="Полномочия ответственных на все выбранные дома проверяются при сохранении." />}
  </ActionPanel>;
}
