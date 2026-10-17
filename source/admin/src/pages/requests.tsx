import { RequestSettings } from "./request-settings";
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
  Modal,
  Select,
  Space,
  Spin,
  Table,
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
  submit_result: "Направить итоговый ответ",
  confirm_result: "Подтвердить результат",
  return_result: "Вернуть на доработку",
  admin_close: "Закрыть после проверки",
  withdraw_report: "Отозвать результат",
  reopen: "Повторно открыть",
  plan_rework: "Начать доработку",
  cancel_request: "Отменить / запросить отмену",
  approve_cancel: "Согласовать отмену",
  reject_cancel: "Отклонить отмену",
  reject: "Отказать по ответственности",
  appeal_reject: "Оспорить отказ",
  uphold_appeal: "Удовлетворить оспаривание",
  submit: "Отправить черновик",
};
const STAFF: Record<string, string[]> = {
  new: ["start_review", "ask_clarification", "reject"],
  reviewing: [
    "ask_clarification",
    "start_work",
    "submit_result",
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
export function RequestsPage() {
  const { identity, roles } = useCabinetIdentity();
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
  const [premisesFilter, setPremisesFilter] = useState<string>(),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [search, setSearch] = useState(""),
    [state, setState] = useState<string>(),
    [channel, setChannel] = useState("resident"),
    [message, setMessage] = useState("");
  const [settings, setSettings] = useState(false);
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
  const messageKey = useRef(crypto.randomUUID()),
    createKey = useRef(crypto.randomUUID());
  const load = async (cursor?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<
        { items: Row[]; next_cursor?: string | null }
      >("/v1/requests/search", {
        method: "POST",
        body: {
          search,
          state,
          cursor,
          premises_id: premisesFilter,
          from: from ? `${from}T00:00:00+05:00` : undefined,
          to: to ? `${to}T23:59:59+05:00` : undefined,
        },
      });
      setRows(result.items);
      setNextCursor(result.next_cursor ?? null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
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
  const refresh = async () => {
    if (card) {
      const next = await apiFetch<Row>(`/v1/requests/${card.id}`);
      setCard(next);
    }
    await load();
  };
  useEffect(() => {
    if (staff) {
      void Promise.all([
        apiFetch<{ items: Row[] }>("/v1/registry/persons"),
        apiFetch<{ items: Row[] }>("/v1/registry/premises"),
      ]).then(([p, r]) => setRegistry({ persons: p.items, premises: r.items }))
        .catch((e) => setError(errorText(e)));
    }
    void load();
    void apiFetch<{ items: Row[] }>("/v1/request-categories").then((r) =>
      setCategories(r.items)
    ).catch((e) => setError(errorText(e)));
    void apiFetch<typeof context>("/v1/requests/context").then(setContext)
      .catch((e) => setError(errorText(e)));
  }, [staff]);
  const own = card?.author_person_id === identity?.me.person.id &&
    card?.can_act_as_author !== false;
  const manage = card?.can_manage === true;
  const perform = async () => {
    if (!card || !action) return;
    try {
      const values = await actionForm.validateFields();
      setSaving(true);
      setError(null);
      const payload = {
        ...values,
        confirmation_version: card.confirmation_version,
        confirmation_payload: {
          summary: values.summary,
          document_version_ids: [],
          task_report_ids: [],
        },
        next_action_at: values.next_action_at
          ? new Date(values.next_action_at).toISOString()
          : undefined,
      };
      await apiFetch(`/v1/requests/${card.id}/transitions`, {
        method: "POST",
        body: {
          action,
          expected_version: card.version,
          reason: values.reason,
          payload,
        },
        idempotencyKey: action === "submit"
          ? `submit:${card.id}:${card.version}`
          : undefined,
      });
      setAction(null);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      if (errorText(e).includes("изменён")) await refresh();
    } finally {
      setSaving(false);
    }
  };
  const send = async () => {
    if (!card) return;
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
    if (!card) return false;
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
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={2}>Обращения</Typography.Title>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={<Button onClick={() => void load()}>Обновить</Button>}
        />
      )}
      <Space wrap>
        <Input.Search
          aria-label="Поиск обращений"
          placeholder="Номер или описание"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={() => void load()}
          style={{ width: 280 }}
        />
        <Select
          aria-label="Статус обращения"
          placeholder="Все статусы"
          allowClear
          value={state}
          onChange={setState}
          options={Object.entries(REQUEST_STATES).map(([value, label]) => ({
            value,
            label,
          }))}
          style={{ width: 230 }}
        />
        <Select
          aria-label="Фильтр по помещению"
          allowClear
          placeholder="Все помещения"
          value={premisesFilter}
          onChange={setPremisesFilter}
          style={{ width: 210 }}
          options={[
            ...context.premises,
            ...registry.premises.filter((p) =>
              !context.premises.some((c) => c.id === p.id)
            ),
          ].map((p) => ({
            value: String(p.id),
            label: `${
              context.buildings.find((b) => b.id === p.building_id)?.name ??
                "Дом"
            }, ${p.number}`,
          }))}
        />
        <Input
          aria-label="Период с"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{ width: 155 }}
        />
        <Input
          aria-label="Период по"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{ width: 155 }}
        />
        <Button onClick={() => void load()}>Применить</Button>
        <Button type="primary" onClick={() => setCreate(true)}>
          Новое обращение
        </Button>
        {staff && !identity?.me.emulation && (
          <Button onClick={() => setSettings(true)}>Категории и файлы</Button>
        )}
      </Space>
      <Table<Row>
        rowKey="id"
        loading={busy}
        dataSource={rows}
        locale={{ emptyText: <Empty description="Обращений пока нет" /> }}
        scroll={{ x: 650 }}
        columns={[
          {
            title: "Номер",
            dataIndex: "number",
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
          { title: "Описание", dataIndex: "description", ellipsis: true },
          { title: "Вид", dataIndex: "kind", render: (v) => KINDS[String(v)] },
          {
            title: "Статус",
            dataIndex: "state",
            render: (v) => <Tag>{REQUEST_STATES[String(v)]}</Tag>,
          },
          {
            title: "Первый ответ до",
            dataIndex: "first_response_due_at",
            render: (v) =>
              v ? new Date(String(v)).toLocaleString("ru-RU") : "—",
          },
        ]}
      />
      {nextCursor && (
        <Button
          loading={busy}
          onClick={() => void load(nextCursor)}
        >
          Следующие 100 обращений
        </Button>
      )}
      {card && (
        <Card
          title={`${card.number ?? "Черновик"} · ${REQUEST_STATES[stateName]}`}
          extra={
            <Button
              disabled={saving || fileBusy}
              onClick={() => {
                openEpoch.current++;
                setCard(null);
              }}
            >
              Закрыть карточку
            </Button>
          }
        >
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions
              column={{ xs: 1, sm: 2 }}
              items={[{
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
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
              {String(card.description)}
            </Typography.Paragraph>
            {manage && (
              <Space wrap>
                <Button
                  onClick={() => {
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
            <Space wrap>
              {[...new Set(actions)].filter((a) =>
                a !== "submit_result" ||
                (card.kind !== "request" && !card.work_execution_required)
              ).map((a) => (
                <Button
                  key={a}
                  onClick={() => {
                    actionForm.resetFields();
                    setAction(a);
                  }}
                >
                  {ACTIONS[a]}
                </Button>
              ))}
            </Space>
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
                        onClick={() =>
                          Modal.confirm({
                            title: "Ограничить ошибочно раскрытое сообщение",
                            content: (
                              <Typography.Text>
                                Уже доставленные копии отозвать нельзя.
                              </Typography.Text>
                            ),
                            onOk: async () => {
                              try {
                                await apiFetch(
                                  `/v1/requests/${card.id}/messages/${m.id}/restrict`,
                                  {
                                    method: "POST",
                                    body: {
                                      reason:
                                        "Ограничение ошибочно раскрытого сообщения администратором",
                                    },
                                  },
                                );
                                await refresh();
                              } catch (e) {
                                setError(errorText(e));
                              }
                            },
                          })}
                      >
                        Ограничить
                      </Button>,
                    ]
                    : []}
                >
                  <List.Item.Meta
                    title={`${m.channel === "internal" ? "Внутреннее · " : ""}${
                      new Date(String(m.created_at)).toLocaleString("ru-RU")
                    }`}
                    description={
                      <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                        {String(m.text)}
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
                        <Button
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
                            disabled={fileBusy}
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
              disabled={card.can_comment === false}
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
              <Upload
                beforeUpload={(file) => upload(file)}
                showUploadList={false}
                disabled={fileBusy || attachments.length >= 10}
              >
                <Button loading={fileBusy}>Добавить файл</Button>
              </Upload>
              <Typography.Text type="secondary">
                До 10 файлов по 20 МиБ. Антивирусная проверка не выполняется.
              </Typography.Text>
              <Button
                type="primary"
                loading={saving}
                disabled={card.can_comment === false || fileBusy ||
                  (!message.trim() && !attachments.length)}
                onClick={() => void send()}
              >
                Отправить в «{channel === "internal" ? "Внутреннее" : "Жителю"}»
              </Button>
            </Space>
            {own && stateName === "closed" && card.close_method === "author" &&
              <RatingEditor id={String(card.id)} onError={setError} />}
            <details>
              <summary>История состояний</summary>
              <List
                dataSource={card.log as Row[]}
                renderItem={(l) => (
                  <List.Item>
                    {(l.meta as Row)?.action === "classified"
                      ? "Исправлено место или классификация"
                      : REQUEST_STATES[String(l.to_state)]}
                    {l.reason ? `: ${String(l.reason)}` : ""} ·{" "}
                    {new Date(String(l.at)).toLocaleString("ru-RU")}
                  </List.Item>
                )}
              />
            </details>
          </Space>
        </Card>
      )}
      {busy && card && <Spin />}
      <RequestSettings
        open={settings}
        onClose={() => setSettings(false)}
        onSaved={() => {
          void apiFetch<{ items: Row[] }>("/v1/request-categories").then((r) =>
            setCategories(r.items)
          );
        }}
      />
      <Modal
        forceRender
        title="Исправить место обращения"
        open={placeEdit}
        onCancel={() => setPlaceEdit(false)}
        confirmLoading={saving}
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
          <Form.Item name="building_id" label="Дом">
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
      </Modal>
      <Modal
        title="Новое обращение"
        open={create}
        onCancel={() => setCreate(false)}
        onOk={() => void submitNew()}
        confirmLoading={saving}
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
      </Modal>
      <Modal
        forceRender
        title={action ? ACTIONS[action] : "Действие"}
        open={!!action}
        onCancel={() => setAction(null)}
        onOk={() => void perform()}
        confirmLoading={saving}
        okText="Подтвердить действие"
      >
        <Form form={actionForm} layout="vertical">
          {!["confirm_result", "start_review", "submit"].includes(
            action ?? "",
          ) && (
            <Form.Item
              name="reason"
              label="Причина / пояснение"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
          {action === "ask_clarification" && (
            <Form.Item
              name="question"
              label="Конкретный вопрос"
              rules={[{ required: true }]}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "answer_clarification" && (
            <Form.Item name="answer" label="Ответ" rules={[{ required: true }]}>
              <Input.TextArea />
            </Form.Item>
          )}
          {["start_work", "plan_rework"].includes(action ?? "") && (
            <Form.Item
              name="plan"
              label="План и ответственный"
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
                <Input type="datetime-local" />
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
          {["reject", "approve_cancel"].includes(action ?? "") && (
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
      </Modal>
    </Space>
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
