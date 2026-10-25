import { FilterOutlined } from "@ant-design/icons";
import { PageSearch } from "../components/page-controls";
import { REGISTRATION_REVIEWER_ROLES } from "../components/process-guidance";
import { ProcessOverview } from "../components/process-card";
import { ConfigurableTable } from "../components/configurable-table";
import { CardDrawer } from "./card-drawer";
import { PageLayout } from "../components/page-layout";
import { TelegramHandle } from "../components/telegram-handle";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format-date";
import { BoardView, ViewToggle, useBoardView } from "./board";
type Row = Record<string, unknown>;
const STATES: Record<string, string> = {
  pending_review: "Ожидает проверки",
  need_clarification: "Нужны уточнения",
  approved: "Доступ подтверждён",
  rejected: "Отказано",
  disputed: "Спор",
  withdrawn: "Отозвана",
};
// Колонки доски — состояния анкеты (VS-2, docs/request-lifecycle.md; споры — до явного решения).
const BOARD_COLUMNS = Object.entries(STATES).map(([value, label]) => ({
  value,
  label,
}));
const DECISION_LABELS: Record<string, string> = {
  approve: "Подтвердить",
  clarify: "Уточнить",
  reject: "Отказать",
  dispute: "Открыть спор",
};
// Уточнение и спор временно скрыты (решение владельца 24.10.2026): эндпоинты
// clarify/dispute сохранены — для возврата вернуть их в списки ниже.
const decisionsFor = (r: Row): string[] =>
  ["pending_review", "need_clarification", "disputed"].includes(
    String(r.state),
  )
    ? ["approve", "reject"]
    : [];
const REASON_LABELS: Record<string, string> = {
  clarify: "Вопрос заявителю",
  reject: "Основание отказа",
  dispute: "Основание спора",
};
// Журнал регистраций (REG-02a): история смен статусов из audit_log.
const JOURNAL_ACTIONS: Record<string, string> = {
  "registration.submit": "Подача анкеты",
  "registration.edit": "Исправление анкеты",
  "registration.approve": "Подтверждена",
  "registration.reject": "Отказ",
  "registration.clarify": "Запрос уточнения",
  "registration.dispute": "Спор",
  "registration.timer": "Истёк срок этапа",
  "registration.delete": "Удаление анкеты",
};
export function RegistrationsPage() {
  const [view, setView] = useBoardView("view.registrations");
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [action, setAction] = useState<{ row: Row; decision: string } | null>(null),
    [persons, setPersons] = useState<Row[]>([]),
    [saving, setSaving] = useState(false);
  const [state, setState] = useState<string>();
  const [search, setSearch] = useState<string>("");
  const [failures, setFailures] = useState<Row[]>([]);
  const [form] = Form.useForm();
  const [manageForm] = Form.useForm();
  const [management, setManagement] = useState<{ row: Row; operation: "edit" | "delete" } | null>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [journal, setJournal] = useState<{ row: Row } | null>(null);
  const [journalData, setJournalData] = useState<Row | null>(null);
  const [journalBusy, setJournalBusy] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const managementKey = useRef(crypto.randomUUID());
  const reading = useRef(false);
  const openJournal = async (row: Row) => {
    setJournal({ row });
    setJournalData(null);
    setJournalError(null);
    setJournalBusy(true);
    try {
      const data = await apiFetch<Row>(
        `/v1/registrations/journal?person_id=${encodeURIComponent(String(row.person_id))}`,
      );
      setJournalData(data);
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setJournalBusy(false);
    }
  };
  const applicantName = (r: Row) => {
    const d = (r.draft as Row | undefined) ?? {};
    const name = String(d.full_name ?? "—");
    // Журнал регистраций — по клику на имя заявителя (REG-02a).
    return r.person_id ? (
      <Button type="link" style={{ padding: 0 }} onClick={() => void openJournal(r)}>{name}</Button>
    ) : name;
  };
  const openManagement = (row: Row, operation: "edit" | "delete") => {
    manageForm.resetFields();
    manageForm.setFieldsValue({ ...(row.draft as Row), language: (row.draft as Row)?.language ?? "ru" });
    managementKey.current = crypto.randomUUID();
    setManagementError(null);
    setManagement({ row: { ...row }, operation });
  };
  const saveManagement = async () => {
    if (!management) return;
    try {
      const values = await manageForm.validateFields();
      setSaving(true);
      await apiFetch(`/v1/registrations/${management.row.id}/manage`, {
        method: "POST", idempotencyKey: managementKey.current,
        body: { ...values, operation: management.operation, expected_version: management.row.version },
      });
      setManagement(null);
      await load();
    } catch (e) {
      if (e instanceof Error) setManagementError(e.message);
    } finally { setSaving(false); }
  };
  const approveDraft =
    action?.decision === "approve"
      ? (action.row.draft as Row | undefined)
      : undefined;
  const matchedPersons = !action?.row.person_id && approveDraft?.phone_e164
    ? persons.filter(
        (p) => String(p.phone_e164) === String(approveDraft.phone_e164),
      )
    : [];
  const load = async (background = false) => {
    if (reading.current) return;
    reading.current = true;
    if (!background) setBusy(true);
    setError(null);
    try {
      const [r, n, f] = await Promise.all([
        apiFetch<{ items: Row[] }>("/v1/registrations"),
        apiFetch<{ items: Row[] }>("/v1/registry/persons").catch(() => ({ items: [] })),
        apiFetch<{ items: Row[] }>("/v1/registry/notification-failures").catch(() => ({ items: [] })),
      ]);
      setRows(r.items);
      setPersons(n.items);
      setFailures(f.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      reading.current = false;
    }
  };
  usePageRefresh(() => load(true), !busy && !saving);
  useEffect(() => {
    void load();
  }, []);
  const decide = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await apiFetch(
        `/v1/registrations/${action!.row.id}/${action!.decision}`,
        { method: "POST", body: { ...values, expected_version: action!.row.version } },
      );
      setAction(null);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const decisionButtons = (r: Row) => [
    ...decisionsFor(r).map((decision) => (
      <Button
        key={decision}
        danger={decision === "reject"}
        onClick={() => {
          form.resetFields();
          setAction({ row: r, decision });
        }}
      >
        {DECISION_LABELS[decision]}
      </Button>
    )),
    ...(r.can_manage ? [
      // Исправление временно скрыто (решение владельца 24.10.2026): manage с
      // operation:"edit" сохранён — кнопка возвращается рядом с «Удалить».
      <Button key="delete" danger onClick={() => openManagement(r, "delete")}>Удалить</Button>,
    ] : []),
  ];
  const visible = rows.filter((r) => {
    if (state && r.state !== state) return false;
    const searchTrim = search.trim().toLocaleLowerCase("ru-RU");
    if (!searchTrim) return true;
    const d = (r.draft as Row | undefined) ?? {};
    const searchable = [d.full_name, d.phone_e164,
      r.telegram_username ? `@${String(r.telegram_username)}` : ""]
      .join(" ").toLocaleLowerCase("ru-RU");
    return searchable.includes(searchTrim);
  });
  return (
    <PageLayout title="Регистрации"
      extra={<ViewToggle kind={view} onChange={setView} />}
      filters={<Space wrap>
        <PageSearch aria-label="Поиск анкет" placeholder="ФИО, телефон или Telegram" value={search}
          onChange={e => setSearch(e.target.value)} style={{ width: 320 }} />
        <Select prefix={<FilterOutlined aria-hidden />}
          aria-label="Состояние анкеты"
          allowClear
          placeholder="Все состояния"
          style={{ width: 240 }}
          value={state}
          onChange={setState}
          options={Object.entries(STATES).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </Space>}> <Typography.Paragraph className="cabinet-page__intro" type="secondary">
            Проверьте анкету по реестру. Спор остаётся открытым до явного решения.
          </Typography.Paragraph>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      {!!failures.length && (
        <Alert
          type="warning"
          showIcon
          message={`Не доставлены уведомления: ${failures.length}`}
          description={
            <ul>
              {failures.slice(0, 10).map((f) => (
                <li key={String(f.id)}>
                  Анкета {String(f.registration_id)}: {String(f.last_error)};
                  попыток {String(f.attempts)}
                </li>
              ))}
            </ul>
          }
        />
      )}
      {view === "board" ? (
        <BoardView
          columns={BOARD_COLUMNS}
          rows={visible}
          stateOf={(r) => String(r.state)}
          loading={busy}
          emptyText="Анкет нет"
          renderCard={(r) => {
            const d = (r.draft as Row | undefined) ?? {};
            return (
              <>
                <Typography.Text strong>{applicantName(r)}</Typography.Text>
                <Typography.Text type="secondary" style={{ display: "block" }}>
                  {String(d.phone_e164 ?? "")}
                </Typography.Text>
                {r.telegram_username ? (
                  <Typography.Text type="secondary" style={{ display: "block" }}>
                    <TelegramHandle username={r.telegram_username} />
                  </Typography.Text>
                ) : null}
                {r.stage_due_at ? (
                  <Typography.Text type="secondary" style={{ display: "block" }}>
                    до {formatDateTime(r.stage_due_at)}
                  </Typography.Text>
                ) : null}
                {!!r.confirmed_draft && <Tag color="blue">Исправления на проверке · прежний доступ сохранён</Tag>}
                {r.overdue_at && <Tag color="red">Просрочено</Tag>}
                {decisionButtons(r).length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {decisionButtons(r)}
                  </div>
                )}
              </>
            );
          }}
        />
      ) : (
        <ConfigurableTable storageKey="columns.registrations" onMobileRowClick={row => { if (row.person_id) void openJournal(row); }} settingsPlacement="page"
          rowKey="id"
          loading={busy}
          dataSource={visible}
          scroll={{ x: 720 }}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: rows.length ? "По выбранным условиям ничего не найдено" : "Анкет нет" }}
          columns={[
            {
              title: "Заявитель",
              render: (_, r) => {
                const d = r.draft as Row;
                return (
                  <>
                    {applicantName(r)}
                    <br />
                    <Typography.Text type="secondary">
                      {String(d?.phone_e164 ?? "")}
                    </Typography.Text>
                  </>
                );
              },
            },
            {
              title: "Telegram",
              dataIndex: "telegram_username",
              render: (v) => <TelegramHandle username={v} />,
            },
            {
              title: "Состояние",
              dataIndex: "state",
              render: (v, r) => <Space direction="vertical"><Tag color={v === "disputed" ? "orange" : undefined}>{STATES[String(v)]}</Tag>
                {!!r.confirmed_draft && <Tag color="blue">Исправления на проверке · прежний доступ сохранён</Tag>}
                {!!r.overdue_at && <Tag color="red">Просрочено</Tag>}</Space>,
            },
            {
              title: "Дата регистрации",
              dataIndex: "created_at",
              render: (v) => formatDateTime(v),
            },
            {
              title: "Дата отзыва",
              dataIndex: "withdrawn_at",
              defaultHidden: true,
              render: (v) => formatDateTime(v),
            },
            {
              title: "Действия",
              render: (_, r) => (
                <Space wrap>{decisionButtons(r)}</Space>
              ),
            },
          ]}
        />
      )}
      <CardDrawer open={!!management} title={management?.operation === "delete" ? "Удаление анкеты" : "Исправление анкеты"}
        onClose={() => setManagement(null)} closeDisabled={saving} hasUnsavedChanges={() => manageForm.isFieldsTouched()}
        footer={<Button type="primary" danger={management?.operation === "delete"} loading={saving} onClick={() => void saveManagement()}>
          {management?.operation === "delete" ? "Удалить анкету" : "Отправить на проверку"}
        </Button>}>
        {management && <ProcessOverview state={STATES[String(management.row.state)]} guidance={{
          title: management.operation === "delete" ? "Нужно подтвердить прекращение доступа" : "Нужно подготовить исправления анкеты",
          description: management.operation === "delete" ? "Проверьте человека и основание удаления. Сохранение прекратит доступ и служебные роли; обращения и история сохранятся." : "Проверьте имя, телефон и язык, укажите основание. Изменения вступят в силу после проверки ОСИ; прежний доступ пока сохранится.",
          waitingFor: REGISTRATION_REVIEWER_ROLES,
        }} />}
        {managementError && <Alert type="error" message={managementError} />}
        {management?.operation === "delete" ? <Alert showIcon type="warning" message="Доступ к боту и кабинету закроется. Служебные роли прекратятся. История обращений и операций сохранится." />
          : <Typography.Paragraph>Исправления проверит ОСИ. До одобрения действуют прежние сведения и доступ.</Typography.Paragraph>}
        {!!management?.row.confirmed_draft && <Typography.Paragraph type="secondary">Действующие данные: {String((management.row.confirmed_draft as Row).full_name)} · {String((management.row.confirmed_draft as Row).phone_e164)}</Typography.Paragraph>}
        <Form form={manageForm} layout="vertical" name="registration-management">
          {management?.operation === "edit" && <>
            <Form.Item name="full_name" label="Имя и фамилия" rules={[{ required: true, whitespace: true, message: "Укажите имя" }]}><Input maxLength={200} /></Form.Item>
            <Form.Item name="phone_e164" label="Телефон" rules={[{ required: true, message: "Укажите телефон" }]}><Input /></Form.Item>
            <Form.Item name="language" label="Язык" rules={[{ required: true }]}><Select options={[{ value: "ru", label: "Русский" }, { value: "kk", label: "Қазақша" }]} /></Form.Item>
          </>}
          <Form.Item name="reason" label="Причина" rules={[{ required: true, whitespace: true, message: "Укажите основание" }]}><Input.TextArea maxLength={300} /></Form.Item>
        </Form>
      </CardDrawer>
      <CardDrawer
        open={!!journal}
        title={journal ? `История регистрации · ${String(((journal.row.draft as Row) ?? {}).full_name ?? "—")}` : "История регистрации"}
        onClose={() => setJournal(null)}
      >
        {journalError && <Alert type="error" showIcon message={journalError} />}
        {journalBusy && <Spin />}
        {journalData && <>
          <Typography.Title level={5} style={{ marginTop: 0 }}>Анкеты заявителя</Typography.Title>
          <Space direction="vertical" size={8} style={{ display: "flex" }}>
            {(journalData.registrations as Row[]).map((r) => (
              <div key={String(r.id)}>
                <Space wrap>
                  <Tag color={r.state === "disputed" ? "orange" : undefined}>{STATES[String(r.state)]}</Tag>
                  {r.superseded_by ? <Tag>Историческая</Tag> : null}
                  {r.premises_id ? (
                    <Typography.Text type="secondary">Привязка · {String(r.building_code ?? "")}, {String(r.number ?? "")}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">Основная анкета</Typography.Text>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ display: "block" }}>
                  Подана {formatDateTime(r.created_at)}
                  {r.decided_at ? ` · решение ${formatDateTime(r.decided_at)}` : ""}
                  {r.withdrawn_at ? ` · отзыв ${formatDateTime(r.withdrawn_at)}` : ""}
                </Typography.Text>
              </div>
            ))}
          </Space>
          <Typography.Title level={5}>История статусов</Typography.Title>
          {(journalData.events as Row[]).length ? (
            <Timeline
              items={(journalData.events as Row[]).map((e, index) => {
                const after = (e.after ?? {}) as Row;
                const before = (e.before ?? {}) as Row;
                return {
                  key: index,
                  color: e.action === "registration.approve" ? "green"
                    : e.action === "registration.reject" || e.action === "registration.delete" ? "red"
                    : e.action === "registration.dispute" || e.action === "registration.timer" ? "orange"
                    : "blue",
                  children: (
                    <>
                      <Typography.Text>{JOURNAL_ACTIONS[String(e.action)] ?? String(e.action)}</Typography.Text>
                      {before.state && after.state && String(before.state) !== String(after.state) ? (
                        <Typography.Text type="secondary"> · {STATES[String(before.state)] ?? String(before.state)} → {STATES[String(after.state)] ?? String(after.state)}</Typography.Text>
                      ) : after.state ? (
                        <Typography.Text type="secondary"> · {STATES[String(after.state)] ?? String(after.state)}</Typography.Text>
                      ) : null}
                      <Typography.Text type="secondary" style={{ display: "block" }}>
                        {formatDateTime(e.at)}{e.actor_name ? ` · ${String(e.actor_name)}` : ""}
                      </Typography.Text>
                      {e.reason ? <Typography.Text type="secondary" style={{ display: "block" }}>Причина: {String(e.reason)}</Typography.Text> : null}
                    </>
                  ),
                };
              })}
            />
          ) : (
            <Typography.Text type="secondary">Событий пока нет</Typography.Text>
          )}
        </>}
      </CardDrawer>
      <Modal
        title={
          action?.decision === "approve"
            ? "Подтверждение анкеты"
            : "Решение по анкете"
        }
        open={!!action}
        onCancel={() => setAction(null)}
        onOk={() => void decide()}
        confirmLoading={saving}
        okText={
          action?.decision === "approve" ? "Подтвердить" : "Сохранить решение"
        }
        cancelText="Отмена"
      >
        {action && <ProcessOverview state={STATES[String(action.row.state)]} due={action.row.stage_due_at} guidance={{
          title: action.decision === "approve" ? "Нужно проверить данные перед подтверждением" : action.decision === "clarify" ? "Нужно запросить недостающие сведения" : action.decision === "dispute" ? "Нужно указать основание спора" : "Нужно обосновать отказ",
          description: action.decision === "approve" ? "Сверьте анкету и совпадения в реестре. Подтверждение изменит доступ заявителя; исправление основной анкеты сохранит прежний доступ и роли." : action.decision === "clarify" ? "Сформулируйте конкретный вопрос. После сохранения заявитель получит запрос уточнения." : "Проверьте сведения и укажите причину решения. Решение сохраняется в истории, заявитель получает уведомление.",
          waitingFor: REGISTRATION_REVIEWER_ROLES,
        }} />}
        <Form name="registration-decision" form={form} layout="vertical">
          {action?.decision === "approve" ? (
            <>
              <Typography.Paragraph>
                Подтвердить анкету{" "}
                <Typography.Text strong>
                  {String(approveDraft?.full_name ?? "—")}
                </Typography.Text>{" "}
                ({String(approveDraft?.phone_e164 ?? "")})?
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                {action.row.confirmed_draft
                  ? "После одобрения обновятся данные пользователя. Прежний доступ и история сохранятся."
                  : "В реестре создаётся карточка заявителя и открывается доступ к обращениям."}
              </Typography.Paragraph>
              {!!matchedPersons.length && (
                <Form.Item
                  name="person_id"
                  label="В реестре уже есть карточка с этим телефоном"
                  required
                  extra="Привяжите анкету к ней. Если это другой человек — сначала исправьте телефон в реестре."
                  rules={[{ required: true, message: "Выберите карточку" }]}
                >
                  <Select
                    options={matchedPersons.map((p) => ({
                      value: String(p.id),
                      label: `${p.full_name} · ${p.phone_e164}`,
                    }))}
                  />
                </Form.Item>
              )}
            </>
          ) : (
            <Form.Item
              name="reason"
              label={
                REASON_LABELS[action?.decision ?? ""] ??
                "Основание решения или вопрос заявителю"
              }
              rules={[{ required: true, message: "Укажите основание" }]}
            >
              <Input.TextArea maxLength={300} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </PageLayout>
  );
}
