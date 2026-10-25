import { PageSearch } from "../components/page-controls";
import { ListFilters } from "../components/list-filters";
import { DeadlineInput } from "../components/deadline-input";
import { ProcessOverview, ProcessActions } from "../components/process-card";
import { requestGuidance, processActionHint } from "../components/process-guidance";
import { ConfigurableTable } from "../components/configurable-table";
import type { ConfigurableColumn } from "../components/table-columns";
import { App as AntApp } from "antd";
import { taskAssigneeOptions } from "./task-assignees";
import { REQUEST_ACTION_ICONS } from "./request-action-icons";
import { TASK_STATE_TEXT } from "../../../core/src/locales/tasks";
import { DetailSection } from "../components/detail-section";
import { DocumentObligationSummary } from "./document-obligation-summary";
import { PageLayout } from "../components/page-layout";
import { requestOverdue, requestOverdueDetails } from "./request-overdue";
import { formatDateTime } from "../lib/format-date";
import "./requests.css";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import { BoardView, ViewToggle, useBoardView } from "./board";
import { CardDrawer } from "./card-drawer";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
type Row = Record<string, unknown>;
export const REQUEST_STATES: Record<string, string> = {
  draft: "Черновик",
  new: "Новая",
  reviewing: "На рассмотрении",
  need_clarification: "Нужно уточнение",
  in_work: "В работе",
  on_hold: "Отложена",
  awaiting_confirmation: "Ожидает подтверждения",
  rework: "На доработке",
  closed: "Закрыта",
  canceled: "Отменена",
  rejected: "Отказано",
};
const KINDS: Record<string, string> = {
  request: "Заявка на работу",
  question: "Вопрос",
  complaint: "Жалоба",
};
const ACTIONS: Record<string, string> = {
  start_review: "Принять на рассмотрение",
  ask_clarification: "Запросить уточнение",
  answer_clarification: "Ответить на уточнение",
  resolve_clarification: "Снять уточнение",
  start_work: "Начать работу",
  hold: "Отложить",
  resume: "Возобновить",
  submit_result: "Итоговый ответ",
  confirm_result: "Подтвердить результат",
  return_result: "Вернуть на доработку",
  admin_close: "Закрыть после проверки",
  withdraw_report: "Отозвать результат",
  reopen: "Повторно открыть",
  plan_rework: "Начать доработку",
  cancel_request: "Отменить / запросить отмену",
  approve_cancel: "Согласовать отмену",
  reject_cancel: "Отклонить отмену",
  reject: "Отклонить",
  appeal_reject: "Оспорить отказ",
  uphold_appeal: "Удовлетворить оспаривание",
  submit: "Отправить черновик",
};
const STAFF: Record<string, string[]> = {
  new: ["start_review", "ask_clarification", "reject"],
  reviewing: [
    "start_work",
    "submit_result",
    "ask_clarification",
    "hold",
    "reject",
  ],
  need_clarification: ["resolve_clarification", "hold", "reject"],
  in_work: ["ask_clarification", "submit_result", "hold", "reject"],
  on_hold: ["resume", "reject"],
  awaiting_confirmation: ["admin_close", "withdraw_report"],
  rework: ["plan_rework", "ask_clarification", "hold", "reject"],
  rejected: ["uphold_appeal"],
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Ошибка запроса";
// Колонки доски — все статусы в порядке жизненного цикла (docs/request-lifecycle.md §3).
const BOARD_COLUMNS = Object.entries(REQUEST_STATES).map(([value, label]) => ({
  value,
  label,
}));
export function RequestsPage() {
  const { identity, roles } = useCabinetIdentity();
  const { message: antMessage } = AntApp.useApp();
  const [view, setView] = useBoardView("view.requests");
  const staff = roles.some((r) =>
    ["chairman", "administrator", "deputy"].includes(r)
  );
  const [registry, setRegistry] = useState<{ persons: Row[]; premises: Row[] }>(
    { persons: [], premises: [] },
  );
  const [rows, setRows] = useState<Row[]>([]),
    [card, setCard] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [buildingFilter, setBuildingFilter] = useState<string>(),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [search, setSearch] = useState("");
  // Состояние можно задать ссылкой вида /requests?state=new (очередь дня на главной).
  const [state, setState] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("state") ?? undefined);
  const [channel, setChannel] = useState("resident"),
    [message, setMessage] = useState("");
  const [cardEditing, setCardEditing] = useState(false);
  const [restricting, setRestricting] = useState<Row | null>(null);
  const [placeEdit, setPlaceEdit] = useState(false);
  const [placeForm] = Form.useForm();
  const [create, setCreate] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [categories, setCategories] = useState<Row[]>([]),
    [context, setContext] = useState<
      { premises: Row[]; buildings: Row[]; staff?: Row[] }
    >({
      premises: [],
      buildings: [],
    });
  const [candidates, setCandidates] = useState<Row[]>([]),
    [attachments, setAttachments] = useState<string[]>([]),
    [fileBusy, setFileBusy] = useState(false);
  const [form] = Form.useForm(), [actionForm] = Form.useForm();
  // Повтор после неопределённого ответа сохраняет ключ и тело операции.
  const draftMessages = useRef<Record<string, string>>({});
  const openEpoch = useRef(0);
  const startWorkKey = useRef(crypto.randomUUID());
  const [executors, setExecutors] = useState<Row[]>([]);
  const [executorsLoading, setExecutorsLoading] = useState(false);
  useEffect(() => {
    if (action !== "start_work" || !card) return;
    let active = true;
    setExecutors([]); setExecutorsLoading(true);
    void apiFetch<{ items: Row[] }>(`/v1/requests/${card.id}/task-assignees`)
      .then(result => { if (active) setExecutors(result.items); })
      .catch(error => { if (active) setError(errorText(error)); })
      .finally(() => { if (active) setExecutorsLoading(false); });
    return () => { active = false; };
  }, [action, card?.id]);
  const messageKey = useRef(crypto.randomUUID()),
    createKey = useRef(crypto.randomUUID());
  const listEpoch = useRef(0);
  const load = async (cursor?: string) => {
    const epoch = ++listEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<
        { items: Row[]; next_cursor?: string | null }
      >("/v1/requests/search", {
        method: "POST",
        body: {
          search: appliedSearch,
          state,
          cursor,
          building_id: buildingFilter,
          from: from ? `${from}T00:00:00+05:00` : undefined,
          to: to ? `${to}T23:59:59.999+05:00` : undefined,
        },
      });
      if (epoch !== listEpoch.current) return;
      setRows(result.items);
      setNextCursor(result.next_cursor ?? null);
    } catch (e) {
      if (epoch === listEpoch.current) setError(errorText(e));
    } finally {
      if (epoch === listEpoch.current) setBusy(false);
    }
  };
  const open = async (id: string) => {
    const epoch = ++openEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const row = await apiFetch<Row>(`/v1/requests/${id}`);
      if (epoch !== openEpoch.current) return;
      setCard(row);
      setMessage("");
      draftMessages.current = {};
      messageKey.current = crypto.randomUUID();
      setAttachments([]);
      setChannel("resident");
      if (
        row.author_person_id === identity?.me.person.id &&
        row.can_share !== false
      ) {
        setCandidates(
          (await apiFetch<{ items: Row[] }>(
            `/v1/requests/${id}/share-candidates`,
          )).items,
        );
      } else setCandidates([]);
    } catch (e) {
      setCard(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!identity?.me.person.id) return;
    const url = new URL(window.location.href);
    const requestId = url.searchParams.get("request");
    if (!requestId) return;
    url.searchParams.delete("request");
    window.history.replaceState(null, "", url);
    void open(requestId);
  }, [identity?.me.person.id]);
  const refresh = async () => {
    if (card) {
      const next = await apiFetch<Row>(`/v1/requests/${card.id}`);
      setCard(next);
    }
    await load();
  };
  usePageRefresh(() => load(), !busy && !saving);
  useEffect(() => {
    // Фильтры выбора применяются сразу, набор текста — после короткой паузы.
    const timer = window.setTimeout(() => setAppliedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    void load();
    return () => { listEpoch.current++; };
  }, [appliedSearch, state, buildingFilter, from, to, staff, identity?.me.person.id]);
  useEffect(() => {
    if (staff) {
      void Promise.all([
        apiFetch<{ items: Row[] }>("/v1/registry/persons"),
        apiFetch<{ items: Row[] }>("/v1/registry/premises"),
      ]).then(([p, r]) => setRegistry({ persons: p.items, premises: r.items }))
        .catch((e) => setError(errorText(e)));
    }
    void apiFetch<{ items: Row[] }>("/v1/request-categories").then((r) =>
      setCategories(r.items)
    ).catch((e) => setError(errorText(e)));
    void apiFetch<typeof context>("/v1/requests/context").then(setContext)
      .catch((e) => setError(errorText(e)));
  }, [staff]);
  const own = card?.author_person_id === identity?.me.person.id &&
    card?.can_act_as_author !== false;
  const manage = card?.can_manage === true;
  const perform = async (directAction?: "start_review") => {
    const nextAction = directAction ?? action;
    if (!card || !nextAction || saving || fileBusy || (directAction && cardEditing)) return;
    try {
      const values = directAction ? {} : await actionForm.validateFields();
      setSaving(true);
      setError(null);
      const payload = {
        ...values,
        ...(nextAction === "reject" && card.work_started_at
          ? { stop_resolution: values.reason }
          : {}),
        confirmation_version: card.confirmation_version,
        confirmation_payload: {
          summary: values.summary,
          document_version_ids: [],
        },
        next_action_at: values.next_action_at
          ? new Date(values.next_action_at).toISOString()
          : undefined,
      };
      if (nextAction === "start_work") {
        await apiFetch(`/v1/requests/${card.id}/start-work`, {
          method: "POST",
          body: { expected_version: card.version, plan: values.plan,
            assignee_person_id: values.assignee_person_id,
            due_at: new Date(values.due_at).toISOString() },
          idempotencyKey: startWorkKey.current,
        });
      } else await apiFetch(`/v1/requests/${card.id}/transitions`, {
        method: "POST",
        body: {
          action: nextAction,
          expected_version: card.version,
          reason: nextAction === "ask_clarification" ? values.question : values.reason,
          payload,
        },
        idempotencyKey: nextAction === "submit"
          ? `submit:${card.id}:${card.version}`
          : undefined,
      });
      setAction(null);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      if (isVersionConflict(e)) {
        try {
          setCard(await apiFetch<Row>(`/v1/requests/${card.id}`));
          setError(VERSION_CONFLICT_MESSAGE);
        } catch (refreshError) { setError(errorText(refreshError)); }
      }
    } finally {
      setSaving(false);
    }
  };
  const send = async () => {
    if (!card || saving || fileBusy || cardEditing) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/v1/requests/${card.id}/messages`, {
        method: "POST",
        body: { text: message, channel, attachments },
        idempotencyKey: messageKey.current,
      });
      messageKey.current = crypto.randomUUID();
      setMessage("");
      delete draftMessages.current[channel];
      setAttachments([]);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const upload = async (file: File, retryId?: string) => {
    if (!card || fileBusy || cardEditing) return false;
    setFileBusy(true);
    setError(null);
    try {
      const f = retryId
        ? await apiFetch<{ attachment_id: string }>(
          `/v1/files/${retryId}/retry`,
          { method: "POST" },
        )
        : await apiFetch<{ attachment_id: string }>("/v1/files/upload-url", {
          method: "POST",
          body: {
            owner_type: "request",
            owner_id: card.id,
            bucket: channel,
            filename: file.name,
            size: file.size,
            mime: file.type,
          },
        });
      // Сохраняем ссылку и при сбое: FIL-02, сообщение можно отправить с incomplete.
      if (!retryId) setAttachments((old) => [...old, f.attachment_id]);
      await apiFetch(`/v1/files/${f.attachment_id}/upload`, {
        method: "POST",
        file,
      });
      await apiFetch(`/v1/files/${f.attachment_id}/complete`, {
        method: "POST",
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setFileBusy(false);
      try {
        await refresh();
      } catch (e) {
        setError(errorText(e));
      }
    }
    return false;
  };
  const submitNew = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const row = await apiFetch<Row>("/v1/requests", {
        method: "POST",
        body: {
          ...values,
          source: values.author_person_id ? values.source : "web",
        },
        idempotencyKey: createKey.current,
      });
      createKey.current = crypto.randomUUID();
      setCreate(false);
      form.resetFields();
      await load();
      await open(String(row.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const stateName = String(card?.state ?? "");
  const actions = [
    ...(manage ? STAFF[stateName] ?? [] : []),
    ...(own
      ? stateName === "draft"
        ? ["submit"]
        : stateName === "awaiting_confirmation"
        ? ["confirm_result", "return_result", "cancel_request"]
        : stateName === "closed"
        ? ["reopen"]
        : stateName === "rejected"
        ? ["appeal_reject"]
        : ["cancel_request"]
      : []),
    ...(stateName === "need_clarification" && !manage
      ? ["answer_clarification"]
      : []),
    ...(manage && card?.cancel_request
      ? ["approve_cancel", "reject_cancel"]
      : []),
  ];
  const tableColumns: ConfigurableColumn<Row>[] = [
    {
      title: "Номер",
      key: "number", dataIndex: "number",
      render: (v, r) => (
        <Button
          type="link"
          disabled={saving || fileBusy}
          onClick={() => void open(String(r.id))}
        >
          {String(v ?? "Черновик")}
        </Button>
      ),
    },
    { title: "Инициатор", key: "author_name", dataIndex: "author_name", render: (v) => String(v ?? "Не указан") },
    { title: "Описание", key: "description", dataIndex: "description", ellipsis: true },
    { title: "Вид", key: "kind", dataIndex: "kind", render: (v) => KINDS[String(v)] },
    {
      title: "Статус",
      key: "state", dataIndex: "state",
      render: (v) => <Tag>{REQUEST_STATES[String(v)]}</Tag>,
    },
    {
      title: "Дата регистрации",
      key: "open_at", dataIndex: "open_at",
      render: (v, r) => formatDateTime(v ?? r.created_at),
    },
    {
      title: "Срок",
      key: "first_response_due_at", dataIndex: "first_response_due_at",
      defaultHidden: true,
      render: (v) =>
        v ? formatDateTime(v) : "—",
    },
  ];
  return (
    <PageLayout title="Обращения"
      extra={<ViewToggle kind={view} onChange={setView} />}
      actions={<Space wrap>
        <Button type="primary" onClick={() => { form.resetFields(); createKey.current = crypto.randomUUID(); setCreate(true); }}>
          Новое обращение
        </Button>
      </Space>}
      filters={<ListFilters
        search={<PageSearch aria-label="Поиск обращений" placeholder="Номер, описание или инициатор" value={search}
          onChange={e => setSearch(e.target.value)} onSearch={() => setAppliedSearch(search)} style={{ width: 280 }} />}
        values={{ state, related: buildingFilter, from, to }}
        onChange={next => { setState(next.state); setBuildingFilter(next.related); setFrom(next.from); setTo(next.to); }}
        stateLabel="Статус обращения" stateOptions={Object.entries(REQUEST_STATES).map(([value, label]) => ({ value, label }))}
        relatedLabel="Фильтр по зданию" relatedOptions={context.buildings.map(b => ({ value: String(b.id), label: String(b.name) }))}
      />} >

      {error && !card && !create && (
        <Alert
          type="error"
          showIcon
          message={error}
        />
      )}

      {view === "board" ? (
        <BoardView
          columns={BOARD_COLUMNS}
          rows={rows}
          stateOf={(r) => String(r.state)}
          onOpen={(r) => void open(String(r.id))}
          selectedId={card ? String(card.id) : null}
          loading={busy}
          emptyText="Обращений пока нет"
          renderCard={(r) => (
            <>
              <Typography.Text strong>
                {String(r.number ?? "Черновик")}
              </Typography.Text>
              <Typography.Paragraph
                ellipsis={{ rows: 2 }}
                style={{ marginBottom: 4 }}
              >
                {String(r.description ?? "")}
              </Typography.Paragraph>
              <Typography.Text type="secondary">
                {KINDS[String(r.kind)]}
              </Typography.Text>
              {!!(r.open_at ?? r.created_at) && (
                <Typography.Text
                  className="request-card__date"
                  type={requestOverdue(r) ? "danger" : "secondary"}
                  title={requestOverdue(r) ? "Обращение просрочено" : "Дата и время подачи обращения"}
                >
                  {formatDateTime(r.open_at ?? r.created_at)}
                  {requestOverdue(r) && <span role="img" aria-label="Просрочено"> ⚠</span>}
                </Typography.Text>
              )}
            </>
          )}
        />
      ) : (
        <ConfigurableTable<Row> storageKey="columns.requests" settingsPlacement="page"
          mobileRender={row => <div className="mobile-summary">
            <div className="mobile-summary__top"><Button type="link" disabled={saving || fileBusy} onClick={() => void open(String(row.id))}>{String(row.number ?? "Черновик")}</Button><Tag>{REQUEST_STATES[String(row.state)]}</Tag></div>
            <p className="mobile-summary__title">{String(row.description ?? "")}</p>
            <span className="mobile-summary__meta">{String(row.author_name ?? "Инициатор не указан")} · {KINDS[String(row.kind)]}</span>
            <Typography.Text type="secondary">Дата регистрации: {formatDateTime(row.open_at ?? row.created_at)}</Typography.Text>
            {requestOverdueDetails(row).map(detail => <Typography.Text type="danger" key={detail}>{detail}</Typography.Text>)}
          </div>}
          rowKey="id"
          loading={busy}
          dataSource={rows}
          locale={{ emptyText: <Empty description="Обращений пока нет" /> }}
          scroll={{ x: 900 }}
          columns={tableColumns}
        />
      )}
      {nextCursor && (
        <Button
          loading={busy}
          onClick={() => void load(nextCursor)}
        >
          Следующие 100 обращений
        </Button>
      )}
      <CardDrawer
        open={!!card || create}
        title={card
          ? `${card.number ?? "Черновик"} · ${REQUEST_STATES[stateName]}`
          : "Новое обращение"}
        onEditingChange={setCardEditing}
        closeDisabled={saving || fileBusy}
        hasUnsavedChanges={() => !!message.trim() || attachments.length > 0}
        onClose={() => {
          openEpoch.current++;
          setCard(null);
          setCreate(false);
        }}
      >
        {error && card && !action && !placeEdit && !create && !restricting && <Alert role="alert" type="error" showIcon message={error} />}
        {card && (
          <div key={String(card.id)} className="process-card-content">
            {requestOverdue(card) && (
              <Alert
                role="alert"
                aria-label="Просрочка обращения"
                type="error"
                showIcon
                message="Обращение просрочено"
                description={
                  <Space direction="vertical" size={4}>
                    {requestOverdueDetails(card).map(detail => <span key={detail}>{detail}</span>)}
                  </Space>
                }
              />
            )}
            <ProcessOverview guidance={requestGuidance(card, manage, own)} state={REQUEST_STATES[stateName]}
              due={["closed", "canceled", "rejected", "awaiting_confirmation"].includes(stateName) ? undefined : !card.first_response_at ? card.first_response_due_at : card.due_at} dueLabel={!card.first_response_at ? "Первый ответ до" : "Выполнение до"}>
              <section aria-label="Действия по процессу">
                {manage && stateName === "in_work" && !requestGuidance(card, manage, own).primary &&
                  <Button type="primary" href="#request-tasks">Проверить связанные задания</Button>}
                <ProcessActions primary={requestGuidance(card, manage, own).primary}>
                  {[...new Set(actions)].map((a) => (
                    <Button
                      key={a}
                      icon={REQUEST_ACTION_ICONS[a]}
                      disabled={saving || fileBusy || cardEditing}
                      loading={saving && a === "start_review"}
                      onClick={() => {
                        if (a === "start_review") {
                          void perform("start_review");
                          return;
                        }
                        actionForm.resetFields();
                        if (a === "start_work") {
                          startWorkKey.current = crypto.randomUUID();
                          actionForm.setFieldsValue({ plan: card.kind === "request"
                            ? String(card.description ?? "")
                            : `Подготовить ответ по обращению ${card.number}` });
                        }
                        setAction(a);
                      }}
                    >
                      {ACTIONS[a]}
                    </Button>
                  ))}
                </ProcessActions>
                {own && stateName === "closed" && card.close_method === "author" &&
                  <RatingEditor id={String(card.id)} onError={setError} />}
              </section>
            </ProcessOverview>
            <DetailSection title="Информация об обращении">
              <Descriptions
                column={{ xs: 1, sm: 2 }}
                items={[{
                  key: "author",
                  label: "Инициатор",
                  children: String(card.author_name ?? "Не указан"),
                }, {
                  key: "kind",
                  label: "Вид",
                  children: KINDS[String(card.kind)],
                }, {
                  key: "place",
                  label: "Место",
                  children: String(
                    card.place_label ?? card.location_text ?? "Общая территория",
                  ),
                }, {
                  key: "source",
                  label: "Источник",
                  children: ({
                    bot: "Telegram",
                    web: "Кабинет",
                    admin: "Администратор",
                    phone: "Телефон",
                    personal: "Лично",
                    whatsapp: "WhatsApp",
                  } as Record<string, string>)[String(card.source)] ??
                    String(card.source),
                }, {
                  key: "close",
                  label: "Подтверждение",
                  children: card.close_method === "administrative"
                    ? "Закрыто администратором"
                    : card.close_method === "author"
                    ? "Подтверждено автором"
                    : "Ожидается",
                }]}
              />
              <div>
                <Typography.Text type="secondary">Сообщение:</Typography.Text>
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                  {String(card.description)}
                </Typography.Paragraph>
              </div>
              {!!card.confirmation && (
                <Alert
                  type="info"
                  message={`Результат, версия ${
                    String(card.confirmation_version)
                  }`}
                  description={String(
                    ((card.confirmation as Row).payload as Row)?.summary ?? "",
                  )}
                />
              )}
              {!!card.confirmation && <List dataSource={((((card.confirmation as Row).payload as Row)?.task_results as Row[])??[])} renderItem={r=><List.Item><div>{String(r.task_number)} — отчёт, версия {String(r.report_version)}<p>{String(r.performed_work)}. {String(r.result)}</p>{!!r.limitations&&<p>Ограничения: {String(r.limitations)}</p>}</div></List.Item>}/>}
                {manage && (
                  <Space wrap>
                    <Button
                      onClick={() => {
                        placeForm.resetFields();
                        placeForm.setFieldsValue({
                          ...card,
                          reason: "",
                          assigned_admin_person_id: card.assigned_admin_person_id ??
                            identity?.me.person.id,
                        });
                        setPlaceEdit(true);
                      }}
                    >
                      Исправить место
                    </Button>
                    <Select
                      aria-label="Срочность обращения"
                      value={String(card.urgency ?? "normal")}
                      options={[
                        { value: "low", label: "Низкая срочность" },
                        { value: "normal", label: "Обычная срочность" },
                        { value: "high", label: "Высокая срочность" },
                        { value: "critical", label: "Критическая срочность" },
                      ]}
                      onChange={async (urgency) => {
                        try {
                          await apiFetch(`/v1/requests/${card.id}`, {
                            method: "PATCH",
                            body: { expected_version: card.version, urgency },
                          });
                          antMessage.success("Срочность обновлена");
                          await refresh();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    />
                    <Select
                      aria-label="Техническая категория"
                      value={card.category_id as string | undefined}
                      placeholder="Классифицировать"
                      options={categories.filter((c) => c.active).map((c) => ({
                        value: String(c.id),
                        label: String(c.name_ru),
                      }))}
                      onChange={async (value) => {
                        try {
                          await apiFetch(`/v1/requests/${card.id}`, {
                            method: "PATCH",
                            body: {
                              expected_version: card.version,
                              category_id: value,
                            },
                          });
                          antMessage.success("Категория обновлена");
                          await refresh();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                      style={{ minWidth: 250 }}
                    />
                    <Select
                      aria-label="Вид обращения"
                      value={String(card.kind)}
                      options={Object.entries(KINDS).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={async (value) => {
                        try {
                          await apiFetch(`/v1/requests/${card.id}`, {
                            method: "PATCH",
                            body: { expected_version: card.version, kind: value },
                          });
                          await refresh();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    />
                  </Space>
                )}
                {own && card.can_share !== false && (
                  <Space wrap>
                    <Select
                      aria-label="Предоставить совместный доступ"
                      placeholder="Житель того же помещения"
                      options={candidates.map((c) => ({
                        value: String(c.person_id),
                        label: String(c.full_name),
                      }))}
                      style={{ width: 260 }}
                      onChange={async (person) => {
                        try {
                          await apiFetch(`/v1/requests/${card.id}/participants`, {
                            method: "POST",
                            body: { person_id: person },
                          });
                          await refresh();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    />
                    {(card.participants as Row[]).filter((p) =>
                      p.role === "participant" && !p.revoked_at
                    ).map((p) => (
                      <Button
                        key={String(p.person_id)}
                        onClick={async () => {
                          try {
                            await apiFetch(
                              `/v1/requests/${card.id}/participants/${p.person_id}`,
                              { method: "DELETE" },
                            );
                            await refresh();
                          } catch (e) {
                            setError(errorText(e));
                          }
                        }}
                      >
                        Отозвать доступ{" "}
                        {candidates.find((c) => c.person_id === p.person_id)
                          ?.full_name as string ?? "участника"}
                      </Button>
                    ))}
                  </Space>
                )}
            </DetailSection>
            {manage && <DetailSection title="Связанные задания">
              <div id="request-tasks" />
              <List dataSource={(card.tasks as Row[] | undefined) ?? []}
                locale={{ emptyText: "Связанных заданий пока нет" }}
                renderItem={task => <List.Item key={String(task.id)}>
                  <Space direction="vertical" size={4}>
                    <Typography.Link href={`/tasks?task=${encodeURIComponent(String(task.id))}`}>{String(task.number)}</Typography.Link>
                    <Typography.Text>{String(task.assignee_name ?? "Исполнитель не назначен")} · {TASK_STATE_TEXT[String(task.state)]?.ru ?? String(task.state)}</Typography.Text>
                    <Typography.Text type="secondary">Срок: {new Date(String(task.due_at)).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</Typography.Text>
                  </Space>
                </List.Item>} />
            </DetailSection>}

            {staff && <DetailSection title="Комплект документов"><DocumentObligationSummary kind="request" id={String(card.id)} /></DetailSection>}
            <DetailSection title="Переписка">
              <Tabs
                activeKey={channel}
                onChange={(value) => {
                  if (saving || fileBusy) return;
                  if (attachments.length) {
                    setError(
                      "Сначала отправьте принятые вложения в выбранный канал",
                    );
                    return;
                  }
                  draftMessages.current[channel] = message;
                  setMessage(draftMessages.current[value] ?? "");
                  messageKey.current = crypto.randomUUID();
                  setChannel(value);
                }}
                items={[
                  { key: "resident", label: "Жителю" },
                  ...(manage ? [{ key: "internal", label: "Внутреннее" }] : []),
                ]}
              />
              {channel === "internal" && (
                <Alert
                  type="warning"
                  showIcon
                  message="Внутреннее сообщение: житель его не увидит"
                />
              )}
              <List
                locale={{ emptyText: "В этом канале пока нет сообщений" }}
                dataSource={(card.messages as Row[]).filter((m) =>
                  m.channel === channel
                )}
                renderItem={(m) => (
                  <List.Item
                    actions={manage && !m.restricted_at
                      ? [
                        <Button
                          key="restrict"
                          size="small"
                          onClick={() => { setError(null); setRestricting(m); }}
                        >
                          Ограничить
                        </Button>,
                      ]
                      : []}
                  >
                    <List.Item.Meta
                      title={`${m.channel === "internal" ? "Внутреннее · " : ""}${
                        formatDateTime(m.created_at)
                      }`}
                      description={
                        <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                          <em>{String(m.author_name ?? "Автор не указан")}</em>{": "}
                          <span>{String(m.text)}</span>
                          {!!m.restricted_at && (
                            <Tag color="red">Доступ ограничен</Tag>
                          )}
                        </Typography.Paragraph>
                      }
                    />
                  </List.Item>
                )}
              />
              <List
                size="small"
                locale={{ emptyText: "Вложений в этом канале нет" }}
                dataSource={(card.attachments as Row[]).filter((a) =>
                  a.bucket === channel
                )}
                renderItem={(a) => (
                  <List.Item>
                    <Space>
                      <Typography.Text>{String(a.filename)}</Typography.Text>
                      {a.status === "complete"
                        ? (
                          <Button disabled={false}
                            size="small"
                            onClick={async () => {
                              try {
                                const r = await apiFetch<{ url: string }>(
                                  `/v1/files/${a.id}/url`,
                                );
                                window.open(
                                  r.url,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              } catch (e) {
                                setError(errorText(e));
                              }
                            }}
                          >
                            Скачать
                          </Button>
                        )
                        : (
                          <Space>
                            <Tag color="orange">Не сохранено</Tag>
                            <Upload
                              beforeUpload={(file) => upload(file, String(a.id))}
                              showUploadList={false}
                              disabled={fileBusy || cardEditing}
                            >
                              <Button size="small">Загрузить повторно</Button>
                            </Upload>
                          </Space>
                        )}
                    </Space>
                  </List.Item>
                )}
              />
              <Input.TextArea
                disabled={card.can_comment === false || cardEditing}
                aria-label="Текст сообщения"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  messageKey.current = crypto.randomUUID();
                }}
                maxLength={10000}
                rows={3}
                placeholder={channel === "internal"
                  ? "Служебное обсуждение"
                  : "Сообщение жителю"}
              />
              <Space wrap>
                <Button
                  type="primary"
                  loading={saving}
                  disabled={card.can_comment === false || cardEditing || fileBusy ||
                    (!message.trim() && !attachments.length)}
                  onClick={() => void send()}
                >
                  Отправить
                </Button>
                <Upload
                  beforeUpload={(file) => upload(file)}
                  showUploadList={false}
                  disabled={fileBusy || cardEditing || attachments.length >= 10}
                >
                  <Button loading={fileBusy}>Добавить файл</Button>
                </Upload>
                <Typography.Text type="secondary">
                  До 10 файлов по 20 МиБ. Антивирусная проверка не выполняется.
                </Typography.Text>
              </Space>
            </DetailSection>
            <DetailSection title="История состояний">
              <details>
                <summary>Показать историю</summary>
                <List
                  dataSource={card.log as Row[]}
                  renderItem={(l) => (
                    <List.Item>
                      {(l.meta as Row)?.action === "classified"
                        ? "Исправлено место или классификация"
                        : REQUEST_STATES[String(l.to_state)]}
                      {l.reason ? `: ${String(l.reason)}` : ""} ·{" "}
                      {formatDateTime(l.at)}
                    </List.Item>
                  )}
                />
              </details>
            </DetailSection>
            {manage && ((card.delivery_failures as Row[] | undefined)?.length ?? 0) > 0 && (
              <Button danger href="/notifications/failures">Открыть журнал доставки</Button>
            )}
          </div>
        )}
      <ActionPanel
        form={placeForm}
        full
        error={error}

        title="Исправить место обращения"
        open={placeEdit}
        onCancel={() => setPlaceEdit(false)}
        busy={saving}
        okText="Сохранить с историей"
        onOk={async () => {
          if (!card) return;
          try {
            const values = await placeForm.validateFields();
            setSaving(true);
            await apiFetch(`/v1/requests/${card.id}`, {
              method: "PATCH",
              body: {
                ...values,
                expected_version: card.version,
                premises_id: values.premises_id ?? null,
                building_id: values.building_id ?? null,
              },
            });
            setPlaceEdit(false);
            await refresh();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={placeForm} name="request-location" layout="vertical">
          <Form.Item name="building_id" label="Дом">
            <Select
              allowClear
              options={context.buildings.map((b) => ({
                value: String(b.id),
                label: String(b.name ?? b.code),
              }))}
            />
          </Form.Item>
          <Form.Item name="premises_id" label="Помещение">
            <Select
              allowClear
              options={registry.premises.map((p) => ({
                value: String(p.id),
                label: `${
                  context.buildings.find((b) => b.id === p.building_id)?.name ??
                    "Дом"
                }, ${p.number}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="location_text"
            label="Место на общем имуществе или территории"
          >
            <Input />
          </Form.Item>
          <Form.Item name="assigned_admin_person_id" label="Сопровождающий">
            <Select
              options={(context.staff ?? []).map((p) => ({
                value: String(p.id),
                label: String(p.full_name),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Причина исправления"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            Совместные доступы прежнего помещения отзываются. Сопровождающий
            должен иметь полномочия для нового места.
          </Typography.Paragraph>
        </Form>
      </ActionPanel>
      <ActionPanel
        form={form}
        full
        error={error}
        title="Новое обращение"
        open={create}
        onCancel={() => setCreate(false)}
        onOk={() => void submitNew()}
        busy={saving}
        okText="Зарегистрировать"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ kind: "request" }}
          onValuesChange={() => {
            createKey.current = crypto.randomUUID();
          }}
        >
          {staff && (
            <>
              <Form.Item
                name="author_person_id"
                label="Заявитель внешнего обращения (пусто — от своего имени)"
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={registry.persons.map((p) => ({
                    value: String(p.id),
                    label: String(p.full_name),
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="source"
                label="Источник внешнего обращения"
                initialValue="phone"
              >
                <Select
                  options={[{ value: "phone", label: "Телефон" }, {
                    value: "personal",
                    label: "Лично",
                  }, { value: "whatsapp", label: "WhatsApp" }]}
                />
              </Form.Item>
            </>
          )}
          <Form.Item name="kind" label="Вид" rules={[{ required: true }]}>
            <Select
              options={Object.entries(KINDS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="premises_id" label="Моё помещение">
            <Select
              allowClear
              options={[
                ...context.premises,
                ...registry.premises.filter((p) =>
                  !context.premises.some((c) => c.id === p.id)
                ),
              ].map((p) => ({
                value: String(p.id),
                label: `${
                  p.building_name ?? context.buildings.find((b) =>
                    b.id === p.building_id
                  )?.name ?? "Дом"
                }, ${p.number}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="building_id" label="Дом общего имущества">
            <Select
              allowClear
              options={context.buildings.map((b) => ({
                value: String(b.id),
                label: String(b.name ?? b.code),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="location_text"
            label="Место на общем имуществе или территории"
          >
            <Input maxLength={1000} />
          </Form.Item>
          <Form.Item
            name="complaint_subject_person_id"
            label="Жалоба на сотрудника (при необходимости)"
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={(context.staff ?? []).map((p) => ({
                value: String(p.id),
                label: String(p.full_name),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="text"
            label="Описание"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={4} maxLength={10000} />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            Категорию уточнит администратор. После регистрации можно добавить
            материалы в переписку.
          </Typography.Paragraph>
        </Form>
      </ActionPanel>
      <ActionPanel
        description={processActionHint("request", action)}
        form={actionForm}
        error={error}

        title={action ? ACTIONS[action] : "Действие"}
        open={!!action}
        onCancel={() => setAction(null)}
        onOk={() => void perform()}
        busy={saving}
        okText={action ? ACTIONS[action] : "Подтвердить"}
        okIcon={action ? REQUEST_ACTION_ICONS[action] : undefined}
      >
        <Form form={actionForm} layout="vertical">
          {!["confirm_result", "start_review", "submit", "ask_clarification", "start_work", "submit_result"].includes(
            action ?? "",
          ) && (
            <Form.Item
              name="reason"
              label={action === "reject" && card?.work_started_at
                ? "Причина отклонения и урегулирование обязательств"
                : "Причина / пояснение"}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
          {action === "ask_clarification" && (
            <Form.Item
              name="question"
              label="Конкретный вопрос"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "answer_clarification" && (
            <Form.Item name="answer" label="Ответ" rules={[{ required: true }]}>
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "start_work" && <>
            <Form.Item name="assignee_person_id" label="Исполнитель" rules={[{ required: true, message: "Выберите исполнителя" }]}>
              <Select loading={executorsLoading} showSearch optionFilterProp="label"
                notFoundContent={executorsLoading ? "Загрузка исполнителей…" : "Нет действующих сотрудников ОСИ"}
                options={taskAssigneeOptions(executors)} />
            </Form.Item>
            <Form.Item name="due_at" label="Срок выполнения" rules={[{ required: true, message: "Укажите срок" }, {
              validator: (_, value) => !value || Date.parse(value) > Date.now()
                ? Promise.resolve() : Promise.reject(new Error("Срок должен быть в будущем")),
            }]}>
              <DeadlineInput />
            </Form.Item>
          </>}
          {["start_work", "plan_rework"].includes(action ?? "") && (
            <Form.Item
              name="plan"
              label={action === "start_work" ? "Описание работы" : "План и ответственный"}
              rules={[{ required: true }]}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "submit_result" && (
            <Form.Item
              name="summary"
              label="Итоговый ответ жителю"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={4} />
            </Form.Item>
          )}
          {action === "hold" && (
            <>
              <Form.Item
                name="next_action_at"
                label="Следующее действие"
                rules={[{ required: true }]}
              >
                <DeadlineInput />
              </Form.Item>
              <Form.Item
                name="responsible_person_id"
                label="Ответственный"
                rules={[{ required: true }]}
              >
                <Select
                  options={(context.staff ?? []).map((p) => ({
                    value: String(p.id),
                    label: String(p.full_name),
                  }))}
                />
              </Form.Item>
            </>
          )}
          {action === "admin_close" && (
            <>
              <Form.Item
                name="verification_method"
                label="Способ проверки"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="verification_materials"
                label="Материалы проверки"
                rules={[{ required: true }]}
              >
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {action === "approve_cancel" && (
            <Form.Item
              name="stop_resolution"
              label="Остановка работ и обязательства"
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "reject" && (
            <Form.Item
              name="route"
              label="Дальнейший маршрут"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
          )}
          {action === "confirm_result" && (
            <Typography.Paragraph>
              Подтверждаете результат версии{" "}
              {String(card?.confirmation_version)}. Молчание не считается
              согласием.
            </Typography.Paragraph>
          )}
        </Form>
      </ActionPanel>
        <ActionPanel open={!!restricting} title="Ограничить ошибочно раскрытое сообщение"
          busy={saving} error={error} onCancel={() => setRestricting(null)}
          okText="Ограничить доступ" onOk={async () => {
            if (!card || !restricting || saving) return;
            setSaving(true); setError(null);
            try {
              await apiFetch(`/v1/requests/${card.id}/messages/${restricting.id}/restrict`, {
                method: "POST", body: { reason: "Ограничение ошибочно раскрытого сообщения администратором" },
              });
              setRestricting(null); await refresh();
            } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
          }}>
          <Typography.Paragraph>{String(restricting?.text ?? "")}</Typography.Paragraph>
          <Alert type="warning" showIcon message="Уже доставленные копии отозвать нельзя." />
        </ActionPanel>
      </CardDrawer>
      {busy && card && <Spin />}

    </PageLayout>
  );
}
function RatingEditor(
  { id, onError }: { id: string; onError: (s: string) => void },
) {
  const [value, setValue] = useState<number | null>(5),
    [comment, setComment] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <Card size="small" title="Оценка результата">
      <Space wrap>
        <InputNumber
          aria-label="Оценка от 1 до 5"
          min={1}
          max={5}
          value={value}
          onChange={setValue}
        />
        <Input
          aria-label="Комментарий к оценке"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button
          onClick={async () => {
            try {
              await apiFetch(`/v1/requests/${id}/rating`, {
                method: "POST",
                body: { value, comment },
              });
              setSaved(true);
            } catch (e) {
              onError(errorText(e));
            }
          }}
        >
          Сохранить оценку
        </Button>
        {saved && <Tag color="green">Сохранено</Tag>}
      </Space>
      <Typography.Paragraph type="secondary">
        Необязательно. Изменение доступно 7 дней после закрытия.
      </Typography.Paragraph>
    </Card>
  );
}
