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
  Tag,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format-date";
import { displayKind, displayRole } from "./registry";
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
/** Анкета-минимум (REG-01) без помещения — место не указано. */
const placeText = (r: Row): string =>
  r.premises_id
    ? `${r.building_code} · ${displayKind(r.kind)} ${r.number}`
    : "Помещение не указано";
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
  const managementKey = useRef(crypto.randomUUID());
  const reading = useRef(false);
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
      r.telegram_username ? `@${String(r.telegram_username)}` : "", placeText(r)]
      .join(" ").toLocaleLowerCase("ru-RU");
    return searchable.includes(searchTrim);
  });
  return (
    <PageLayout title="Регистрации"
      extra={<ViewToggle kind={view} onChange={setView} />}
      filters={<Space wrap>
        <Input.Search aria-label="Поиск анкет" placeholder="ФИО, телефон, Telegram или помещение" value={search}
          onChange={e => setSearch(e.target.value)} style={{ width: 320 }} />
        <Select
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
      </Space>}> <Typography.Paragraph type="secondary">
            Проверьте анкету по реестру. Выбор роли пользователем не предоставляет
            доступ. Спор остаётся открытым до явного решения.
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
                <Typography.Text strong>
                  {String(d.full_name ?? "—")}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: "block" }}>
                  {String(d.phone_e164 ?? "")}
                </Typography.Text>
                {r.telegram_username ? (
                  <Typography.Text type="secondary" style={{ display: "block" }}>
                    <TelegramHandle username={r.telegram_username} />
                  </Typography.Text>
                ) : null}
                <Typography.Text style={{ display: "block" }}>
                  {placeText(r)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: "block" }}>
                  {r.role ? displayRole(r.role) : ""}
                  {r.stage_due_at
                    ? ` · до ${formatDateTime(r.stage_due_at)}`
                    : ""}
                </Typography.Text>
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
        <ConfigurableTable storageKey="columns.registrations" settingsPlacement="page"
          rowKey="id"
          loading={busy}
          dataSource={visible}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: rows.length ? "По выбранным условиям ничего не найдено" : "Анкет нет" }}
          columns={[
            {
              title: "Заявитель",
              render: (_, r) => {
                const d = r.draft as Row;
                return (
                  <>
                    {String(d?.full_name ?? "—")}
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
              title: "Помещение",
              render: (_, r) => placeText(r),
            },
            {
              title: "Отношение",
              dataIndex: "role",
              render: (v) => (v ? displayRole(v) : "—"),
            },
            {
              title: "Состояние",
              dataIndex: "state",
              render: (v, r) => <Space direction="vertical"><Tag color={v === "disputed" ? "orange" : undefined}>{STATES[String(v)]}</Tag>
                {!!r.confirmed_draft && <Tag color="blue">Исправления на проверке · прежний доступ сохранён</Tag>}</Space>,
            },
            {
              title: "Срок",
              dataIndex: "stage_due_at",
              render: (_, r) => (
                <>
                  {r.stage_due_at
                    ? new Date(String(r.stage_due_at)).toLocaleString("ru-RU")
                    : "—"}
                  {r.overdue_at && <Tag color="red">Просрочено</Tag>}
                </>
              ),
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
          description: management.operation === "delete" ? "Проверьте человека и основание удаления. Сохранение прекратит доступ, роли и связи; обращения и история сохранятся." : "Проверьте имя, телефон и язык, укажите основание. Изменения вступят в силу после проверки ОСИ; прежний доступ пока сохранится.",
          waitingFor: REGISTRATION_REVIEWER_ROLES,
        }} />}
        {managementError && <Alert type="error" message={managementError} />}
        {management?.operation === "delete" ? <Alert showIcon type="warning" message="Доступ к боту и кабинету закроется. Связи с помещениями и служебные роли прекратятся. История обращений и операций сохранится." />
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
          description: action.decision === "approve" ? "Сверьте анкету и совпадения в реестре. Подтверждение изменит доступ заявителя; исправление основной анкеты сохранит действующие связи и роли." : action.decision === "clarify" ? "Сформулируйте конкретный вопрос. После сохранения заявитель получит запрос уточнения." : "Проверьте сведения и укажите причину решения. Решение сохраняется в истории, заявитель получает уведомление.",
          waitingFor: action.row.review_stage === "owner" ? "Собственник помещения" : REGISTRATION_REVIEWER_ROLES,
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
                  ? "После одобрения обновятся данные пользователя. Связи, роли и история сохранятся."
                  : action.row.premises_id
                  ? <>В реестре создаётся карточка заявителя и подтверждается доступ: {" "}
                    {String(action.row.building_code)} · {displayKind(action.row.kind)}{" "}
                    {String(action.row.number)}, {displayRole(action.row.role)}.</>
                  : "В реестре создаётся карточка заявителя и открывается доступ к обращениям без привязки к помещению. Помещение заявитель добавит позже командой /add в боте."}
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
