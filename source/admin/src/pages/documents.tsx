import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, List, Select, Space, Spin, Tag, Typography } from "antd";
import { PageLayout } from "../components/page-layout";
import { ConfigurableTable } from "../components/configurable-table";
import { DetailSection } from "../components/detail-section";
import { CardDrawer } from "./card-drawer";
import { ActionPanel } from "./action-panel";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { DocumentObligations } from "./document-obligations";
type Row = Record<string, unknown>;
interface Version extends Row { id: string; version: number; state: string; attachment_id: string; signed_attachment_id?: string }
interface Card extends Row { id: string; title: string; version: number; versions: Version[]; history: Row[]; can_prepare: boolean; can_review: boolean; can_manage: boolean }
const kinds: Record<string, string> = { act: "Акт", work_report: "Отчёт работы", invoice: "Счёт", receipt: "Квитанция", decision_basis: "Основание решения", instruction: "Инструкция", financial_report: "Финансовый отчёт", other: "Другой документ" };
const audiences: Record<string, string> = { resident: "Жители", owner: "Собственники", staff: "Сотрудники", finance: "Финансовая", service: "Поддержка" };
const states: Record<string, string> = { draft: "Черновик", on_review: "На проверке", approved: "Проверен", returned: "Возвращён", needs_fix: "Требует исправления" };
const names: Record<string, string> = { create: "Новый документ", version: "Новая версия", submit: "На проверку", approve: "Проверить", return: "Вернуть", "needs-fix": "Требует исправления", publish: "Опубликовать" };
const required = [{ required: true, message: "Заполните поле" }];
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => ({ value, label }));

export function DocumentsPage() {
  const { roles, identity } = useCabinetIdentity();
  const manager = roles.some(r => ["chairman", "administrator", "deputy"].includes(r));
  const [rows, setRows] = useState<Row[]>([]), [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [action, setAction] = useState<string | null>(null);
  const [selected, setSelected] = useState<Version | null>(null), [buildings, setBuildings] = useState<Row[]>([]), [people, setPeople] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]), [tasks, setTasks] = useState<Row[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [file, setFile] = useState<File | null>(null), [signed, setSigned] = useState<File | null>(null);
  const [form] = Form.useForm(), key = useRef(crypto.randomUUID()), generation = useRef(0), staged = useRef<{ main?: string; signed?: string }>({});
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
  async function load() {
    const current = ++generation.current; setBusy(true); setError(null);
    try { const result = await apiFetch<{ items: Row[]; total: number }>(page === 1 ? "/v1/documents" : `/v1/documents?offset=${(page - 1) * 50}`); if (current === generation.current) { setRows(result.items); setTotal(result.total); } }
    catch (e) { if (current === generation.current) fail(e); }
    finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => { setCard(null); setAction(null); void load(); return () => { generation.current++; }; }, [identity?.id, page]);
  usePageRefresh(load, () => !card && !action && !busy);
  async function open(id: string) {
    const current = ++generation.current; setBusy(true); setError(null);
    try { const next = await apiFetch<Card>(`/v1/documents/${id}`); if (current === generation.current) setCard(next); }
    catch (e) { if (current === generation.current) fail(e); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function begin(next: string, v: Version | null = null) {
    setAction(next); setSelected(v); setError(null); form.resetFields(); key.current = crypto.randomUUID(); staged.current = {}; setFile(null); setSigned(null);
    if (next !== "create") return;
    setBusy(true);
    try {
      const [b, p, r, t] = await Promise.all([apiFetch<{ items: Row[] }>("/v1/registry/buildings"), apiFetch<{ items: Row[] }>("/v1/documents/candidates"), apiFetch<{ items: Row[] }>("/v1/requests"), apiFetch<{ items: Row[] }>("/v1/tasks")]);
      setBuildings(b.items); setPeople(p.items); setRequests(r.items); setTasks(t.items);
      form.setFieldsValue({ kind: "act", audience: "staff", building_ids: [], parties: "ОСИ" });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function stage(f: File, field: "main" | "signed") {
    if (staged.current[field]) return staged.current[field]!;
    const prepared = await apiFetch<{ attachment_id: string }>("/v1/files/upload-url", { method: "POST", body: { owner_type: "document", owner_id: card!.id, expected_version: card!.version, filename: f.name, size: f.size, mime: f.type } });
    await apiFetch(`/v1/files/${prepared.attachment_id}/upload`, { method: "POST", file: f });
    await apiFetch(`/v1/files/${prepared.attachment_id}/complete`, { method: "POST" });
    staged.current[field] = prepared.attachment_id;
    return prepared.attachment_id;
  }
  async function submit() {
    if (busy) return;
    let values: Row;
    try { values = await form.validateFields(); } catch { return; }
    setBusy(true); setError(null);
    try {
      let path = "/v1/documents";
      const body: Row = { ...values };
      if (action !== "create") {
        if (!card) throw new Error("Обновите карточку документа");
        body.expected_version = card.version;
        if (action === "version") {
          if (!file) throw new Error("Выберите файл новой версии");
          path = `/v1/documents/${card.id}/versions`;
          body.attachment_id = await stage(file, "main");
          if (signed) body.signed_attachment_id = await stage(signed, "signed");
        } else if (action === "publish") { path = `/v1/documents/${card.id}/publish`; body.document_version_id = selected!.id; }
        else path = `/v1/documents/${card.id}/versions/${selected!.version}/${action}`;
      }
      const saved = await apiFetch<Row>(path, { method: "POST", body, idempotencyKey: key.current });
      const id = action === "create" ? String(saved.id) : card!.id;
      setAction(null); form.resetFields(); staged.current = {};
      await open(id);
    } catch (e) {
      if (isVersionConflict(e) && card) {
        setError(VERSION_CONFLICT_MESSAGE);
        try { setCard(await apiFetch<Card>(`/v1/documents/${card.id}`)); } catch { /* Сохранить форму и первоначальную ошибку конфликта. */ }
      } else fail(e);
    } finally { setBusy(false); }
  }
  async function download(id: string) {
    setBusy(true); setError(null);
    try { const result = await apiFetch<{ url: string }>(`/v1/files/${id}/url`); window.open(result.url, "_blank", "noopener,noreferrer"); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  const close = () => { setCard(null); setAction(null); void load(); };
  return <PageLayout title="Документы" actions={<Space wrap><Button onClick={() => void load()} disabled={busy}>Обновить</Button>{manager && <Button type="primary" onClick={() => void begin("create")} disabled={busy}>Новый документ</Button>}</Space>}>
    {error && !card && !action && <Alert type="error" showIcon message={error} />}
    <ConfigurableTable storageKey="columns.documents" settingsPlacement="page" rowKey="id" dataSource={rows} pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: setPage }} loading={busy && !card && !action} locale={{ emptyText: "Документов нет" }} scroll={{ x: 650 }} columns={[
      { title: "Название", dataIndex: "title" }, { title: "Тип", dataIndex: "kind", render: (v: string) => kinds[v] ?? v },
      { title: "Дата", dataIndex: "document_date", render: (v: string) => v ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty" }).format(new Date(v)) : "—" },
      { title: "Действия", key: "actions", render: (_, r) => <Button onClick={() => void open(String(r.id))} disabled={busy}>Открыть</Button> },
    ]} />
    {roles.some(r => r !== "tech_admin") && <DetailSection title="Документальные обязательства"><DocumentObligations manager={manager} /></DetailSection>}
    <CardDrawer open={!!card || action === "create"} title={card?.title ?? "Новый документ"} onClose={close} closeDisabled={busy}>
      {error && !action && <Alert type="error" showIcon message={error} />}
      {busy && !card && !action && <Spin />}
      {card && <>
        <DetailSection title="Карточка документа"><Typography.Paragraph>Аудитория: {audiences[String(card.audience)]}. Стороны: {String(card.parties ?? "—")}</Typography.Paragraph><Typography.Paragraph>Telegram-подтверждение не является подписанием юридического акта.</Typography.Paragraph>
          {card.can_prepare && <Button onClick={() => void begin("version")} disabled={busy}>Новая версия</Button>}
        </DetailSection>
        <DetailSection title="Версии"><List dataSource={card.versions} locale={{ emptyText: "Версий пока нет" }} renderItem={v => <List.Item><Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap><Typography.Text>Версия {v.version}</Typography.Text><Tag color={v.state === "needs_fix" ? "error" : undefined}>{states[v.state] ?? v.state}</Tag></Space>
          {!!v.review_comment && <Typography.Paragraph>{String(v.review_comment)}</Typography.Paragraph>}
          {v.signed_attachment_id && (card.can_prepare || card.can_review || card.can_manage) && <Typography.Paragraph>Способ проверки подписи: {String(v.signature_method ?? "—")}<br />Основание: {String(v.signature_basis ?? "—")}</Typography.Paragraph>}
          <Space wrap><Button onClick={() => void download(v.attachment_id)} disabled={busy}>Файл версии {v.version}</Button>{v.signed_attachment_id && <Button onClick={() => void download(v.signed_attachment_id!)} disabled={busy}>Подписанный экземпляр</Button>}
            {card.can_prepare && v.state === "draft" && <Button onClick={() => void begin("submit", v)}>На проверку</Button>}
            {card.can_review && v.state === "on_review" && <><Button onClick={() => void begin("approve", v)}>Проверить</Button><Button onClick={() => void begin("return", v)}>Вернуть</Button></>}
            {card.can_review && v.state === "approved" && <Button danger onClick={() => void begin("needs-fix", v)}>Требует исправления</Button>}
            {card.can_manage && v.state === "approved" && card.published_version_id !== v.id && <Button onClick={() => void begin("publish", v)}>Опубликовать</Button>}
          </Space>
        </Space></List.Item>} /></DetailSection>
        {!!card.history.length && <DetailSection title="История проверки"><List dataSource={card.history} renderItem={h => <List.Item>{String(h.reason)}</List.Item>} /></DetailSection>}
      </>}
      <ActionPanel open={!!action} title={names[action ?? ""] ?? "Документ"} busy={busy} error={error} form={form} onCancel={() => { setAction(null); setError(null); }} onOk={() => void submit()} okText="Сохранить">
        <Form layout="vertical" form={form}>
          {action === "create" && <>
            <Form.Item label="Название" name="title" rules={required}><Input maxLength={10000} /></Form.Item>
            <Form.Item label="Тип документа" name="kind" rules={required}><Select options={options(kinds)} /></Form.Item>
            <Form.Item label="Аудитория" name="audience" rules={required}><Select options={options(audiences).filter(o => o.value !== "service")} /></Form.Item>
            <Form.Item label="Дома" name="building_ids"><Select mode="multiple" options={buildings.map(b => ({ value: b.id, label: String(b.code) }))} /></Form.Item>
            <Form.Item label="Номер документа" name="document_number"><Input /></Form.Item>
            <Form.Item label="Дата документа" name="document_date" rules={required}><Input type="date" /></Form.Item>
            <Form.Item label="Стороны" name="parties" rules={required}><Input /></Form.Item>
            <Form.Item label="Подготовитель" name="prepared_by" rules={required}><Select showSearch optionFilterProp="label" options={people.map(p => ({ value: p.id, label: String(p.full_name) }))} /></Form.Item>
            <Form.Item label="Проверяющий" name="reviewer_id" rules={required}><Select showSearch optionFilterProp="label" options={people.filter(p => (p.roles as string[]).some(r => ["chairman", "administrator", "deputy", "doc_reviewer"].includes(r))).map(p => ({ value: p.id, label: String(p.full_name) }))} /></Form.Item>
            <Form.Item label="Обращение" name="request_id"><Select allowClear showSearch optionFilterProp="label" options={requests.map(r => ({ value: r.id, label: `${r.number}: ${r.title ?? "Обращение"}` }))} /></Form.Item>
            <Form.Item label="Задание (вместо обращения)" name="task_id"><Select allowClear showSearch optionFilterProp="label" options={tasks.map(t => ({ value: t.id, label: `${t.number}: ${t.title ?? "Задание"}` }))} /></Form.Item>
          </>}
          {action === "version" && <>
            <Form.Item label="Файл новой версии" required><Input type="file" aria-label="Файл новой версии" onChange={e => { setFile(e.target.files?.[0] ?? null); delete staged.current.main; }} /></Form.Item>
            <Form.Item label="Подписанный вне системы экземпляр"><Input type="file" aria-label="Подписанный экземпляр" onChange={e => { setSigned(e.target.files?.[0] ?? null); delete staged.current.signed; }} /></Form.Item>
            {signed && <><Form.Item label="Способ проверки подписи" name="signature_method" rules={required}><Input /></Form.Item><Form.Item label="Основание проверки подписи" name="signature_basis" rules={required}><Input /></Form.Item></>}
          </>}
          <Form.Item label="Причина / основание" name="reason" rules={required}><Input.TextArea rows={3} maxLength={10000} /></Form.Item>
        </Form>
      </ActionPanel>
    </CardDrawer>
  </PageLayout>;
}
