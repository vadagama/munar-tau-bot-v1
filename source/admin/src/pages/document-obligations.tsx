import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, Select, Space, Typography } from "antd";
import { ConfigurableTable } from "../components/configurable-table";
import { CardDrawer } from "./card-drawer";
import { ActionPanel } from "./action-panel";
import { apiFetch } from "../lib/api";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
type Row = Record<string, unknown>;
const kinds: Record<string, string> = { act: "Акт", work_report: "Отчёт работы", decision_basis: "Основание решения", invoice: "Счёт", receipt: "Квитанция", instruction: "Инструкция", financial_report: "Финансовый отчёт", other: "Другой документ" };
const required = [{ required: true, message: "Заполните поле" }];
export function DocumentObligations({ manager }: { manager: boolean }) {
  const [rows, setRows] = useState<Row[]>([]), [action, setAction] = useState<string | null>(null), [target, setTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [sources, setSources] = useState<Row[]>([]), [people, setPeople] = useState<Row[]>([]), [documents, setDocuments] = useState<Row[]>([]), [versions, setVersions] = useState<Row[]>([]);
  const [form] = Form.useForm(), key = useRef(crypto.randomUUID()), generation = useRef(0);
  const [documentTotal, setDocumentTotal] = useState(0);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Не удалось загрузить обязанности");
  async function load() {
    const current = ++generation.current; setBusy(true);
    try { const result = await apiFetch<{ items: Row[] }>("/v1/documents/obligations"); if (current === generation.current) { setRows(result.items); setError(null); } }
    catch (e) { if (current === generation.current) fail(e); }
    finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  usePageRefresh(load, () => !action && !busy);
  async function begin(next: string, row: Row | null = null) {
    setTarget(row); setAction(next); setBusy(true); setError(null); form.resetFields(); key.current = crypto.randomUUID(); setVersions([]);
    try {
      if (next === "fulfill") { const result = await apiFetch<{ items: Row[]; total: number }>("/v1/documents"); setDocuments(result.items); setDocumentTotal(result.total); }
      else {
        const p = await apiFetch<{ items: Row[] }>("/v1/documents/candidates"); setPeople(p.items);
        if (next === "create") {
          const [requests, tasks] = await Promise.all([apiFetch<{ items: Row[] }>("/v1/requests"), apiFetch<{ items: Row[] }>("/v1/tasks")]);
          setSources([...requests.items.map(r => ({ ...r, source_key: `request:${r.id}`, label: `Обращение ${r.number}` })), ...tasks.items.map(t => ({ ...t, source_key: `task:${t.id}`, label: `Задание ${t.number}` }))]);
          form.setFieldsValue({ kind: "act", phase: "before_acceptance", signed_required: false });
        } else form.setFieldsValue({ prepared_by: row?.prepared_by, reviewer_id: row?.reviewer_id });
      }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function pickDocument(id: string) {
    setBusy(true); form.setFieldValue("document_version_id", undefined);
    try { const card = await apiFetch<{ versions: Row[] }>(`/v1/documents/${id}`); setVersions(card.versions.filter(v => v.state === "approved")); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function moreDocuments() {
    setBusy(true);
    try {
      const result = await apiFetch<{ items: Row[]; total: number }>(`/v1/documents?offset=${documents.length}&limit=50`);
      setDocuments(old => [...old, ...result.items]); setDocumentTotal(result.total);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function submit() {
    if (busy) return;
    let values: Row; try { values = await form.validateFields(); } catch { return; }
    const body: Row = { ...values };
    let path = `/v1/documents/obligations/${target?.id}/${action}`;
    if (action === "create") {
      const source = sources.find(s => s.source_key === values.source_key);
      if (!source) { setError("Выберите исходный объект"); return; }
      body[String(values.source_key).startsWith("task:") ? "task_id" : "request_id"] = source.id;
      body.expected_version = source.version; delete body.source_key; path = "/v1/documents/obligations";
    } else body.expected_version = target!.version;
    delete body.document_id;
    setBusy(true); setError(null);
    try { await apiFetch(path, { method: "POST", body, idempotencyKey: key.current }); setAction(null); await load(); }
    catch (e) {
      setError(isVersionConflict(e) ? VERSION_CONFLICT_MESSAGE : e instanceof Error ? e.message : "Не удалось сохранить обязанность");
      if (isVersionConflict(e)) {
        try {
          if (action === "create") {
            const source = sources.find(s => s.source_key === values.source_key)!;
            const fresh = await apiFetch<Row>(`/v1/${String(values.source_key).startsWith("task:") ? "tasks" : "requests"}/${source.id}`);
            setSources(old => old.map(s => s.source_key === source.source_key ? { ...s, version: fresh.version } : s));
          } else {
            const result = await apiFetch<{ items: Row[] }>("/v1/documents/obligations");
            setRows(result.items); setTarget(result.items.find(r => r.id === target!.id) ?? target);
          }
        } catch { /* Первоначальный конфликт и введённая форма остаются видимыми. */ }
      }
    }
    finally { setBusy(false); }
  }
  const personOptions = people.map(p => ({ value: p.id, label: String(p.full_name) }));
  return <>
    <Space wrap>{manager && <Button disabled={busy} onClick={() => void begin("create")}>Новое обязательство</Button>}</Space>
    {error && !action && <Alert type="error" message={error} showIcon />}
    <ConfigurableTable storageKey="columns.document-obligations" settingsPlacement="inline" rowKey="id" dataSource={rows} loading={busy && !action} locale={{ emptyText: "Документальных обязательств нет" }} scroll={{ x: 700 }} columns={[
      { title: "Объект", dataIndex: "source_number" }, { title: "Документ", dataIndex: "kind", render: (v: string) => kinds[v] ?? v },
      { title: "Этап", dataIndex: "phase", render: (v: string) => v === "before_acceptance" ? "До приёмки" : "После приёмки" },
      { title: "Ответственный", dataIndex: "prepared_name" },
      { title: "Проверяющий", dataIndex: "reviewer_name" },
      { title: "Срок", dataIndex: "due_at", render: (v: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(v)) },
      { title: "Состояние", render: (_, r) => r.completed_at ? "Выполнено" : "Не завершено" },
      { title: "Действия", key: "actions", render: (_, r) => r.can_manage && !r.completed_at ? <Space wrap><Button onClick={() => void begin("fulfill", r)}>Указать проверенную версию</Button><Button onClick={() => void begin("reassign", r)}>Передать обязанность</Button></Space> : null },
    ]} />
    <CardDrawer open={!!action} title={action === "create" ? "Новое обязательство" : action === "reassign" ? "Передача обязанности" : "Проверенный комплект"} onClose={() => setAction(null)} closeDisabled={busy}>
      <ActionPanel open={!!action} title="Документальное обязательство" busy={busy} error={error} form={form} onCancel={() => setAction(null)} onOk={() => void submit()} okText="Сохранить">
        <Typography.Paragraph>Срок задаётся действующей версией регламента. Закрытие обращения не завершает эту обязанность автоматически.</Typography.Paragraph>
        <Form form={form} layout="vertical">
          {action === "create" && <>
            <Form.Item name="source_key" label="Обращение или задание" rules={required}><Select showSearch optionFilterProp="label" options={sources.map(s => ({ value: s.source_key, label: String(s.label) }))} /></Form.Item>
            <Form.Item name="kind" label="Необходимый документ" rules={required}><Select options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item name="phase" label="Этап предоставления" rules={required}><Select options={[{ value: "before_acceptance", label: "До приёмки" }, { value: "after_acceptance", label: "После приёмки" }]} /></Form.Item>
            <Form.Item name="basis" label="Основание обязательности" rules={required}><Input.TextArea maxLength={10000} /></Form.Item>
            <Form.Item name="signed_required" valuePropName="checked"><Checkbox>Требуется подписанный вне системы экземпляр</Checkbox></Form.Item>
          </>}
          {action !== "fulfill" && <><Form.Item name="prepared_by" label="Ответственный за подготовку" rules={required}><Select showSearch optionFilterProp="label" options={personOptions} /></Form.Item><Form.Item name="reviewer_id" label="Проверяющий" rules={required}><Select showSearch optionFilterProp="label" options={personOptions} /></Form.Item></>}
          {action === "fulfill" && <><Form.Item name="document_id" label="Документ" rules={required}><Select disabled={busy} showSearch optionFilterProp="label" options={documents.map(d => ({ value: d.id, label: String(d.title) }))} onChange={id => void pickDocument(String(id))} /></Form.Item>{documents.length < documentTotal && <Button disabled={busy} onClick={() => void moreDocuments()}>Загрузить ещё документы</Button>}<Form.Item name="document_version_id" label="Проверенная версия" rules={required}><Select disabled={busy} options={versions.map(v => ({ value: v.id, label: `Версия ${v.version}` }))} /></Form.Item></>}
          <Form.Item name="reason" label="Причина / основание действия" rules={required}><Input.TextArea rows={3} maxLength={10000} /></Form.Item>
        </Form>
      </ActionPanel>
    </CardDrawer>
  </>;
}
