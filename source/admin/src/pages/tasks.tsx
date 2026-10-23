import { DeadlineInput } from "../components/deadline-input";
import { ProcessOverview, ProcessActions, ProcessHistory } from "../components/process-card";
import { taskGuidance, processActionHint } from "../components/process-guidance";
import { DetailSection } from "../components/detail-section";
import { DocumentObligationSummary } from "./document-obligation-summary";
import { ConfigurableTable } from "../components/configurable-table";
import type { TableColumnsType } from "antd";
import { taskAssigneeOptions } from "./task-assignees";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import { TaskProblems } from "./task-problems";
import { TaskReportForm } from "./task-report";
import { BoardView, ViewToggle, useBoardView } from "./board";
import { CardDrawer } from "./card-drawer";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import {
  TASK_ACTION_TEXT,
  TASK_STATE_TEXT,
} from "../../../core/src/locales/tasks";
type Row = Record<string, unknown>;
interface Task extends Row {
  id: string;
  number: string;
  title: string;
  instruction: string;
  state: string;
  version: number;
  due_at: string;
  created_at?: string;
  linked_request?: { id: string; number: string } | null;
  request_id: string;
  can_manage?: boolean;
  can_approve?: boolean;
  can_execute?: boolean;
  assignee_person_id?: string | null;
  assignee_name?: string | null;
  log?: Row[];
  delivery_failures?: {id:string;last_error:string;followup_state:string}[];
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Ошибка запроса";
const required = [{ required: true, message: "Заполните поле" }];
// Колонки доски — состояния задания в порядке жизненного цикла (docs/request-lifecycle.md §5).
const BOARD_COLUMNS = Object.entries(TASK_STATE_TEXT).map(([value, label]) => ({
  value,
  label: label.ru,
}));
const TASK_DONE_STATES = ["accepted_admin", "canceled"];
const overdue = (t: Task) =>
  new Date(t.due_at).getTime() < Date.now() &&
  !TASK_DONE_STATES.includes(t.state);
export function TasksPage() {
  const { identity, roles } = useCabinetIdentity();
  const { token } = theme.useToken();
  const [view, setView] = useBoardView("view.tasks");
  const manager = roles.some((r) =>
    ["chairman", "administrator", "deputy"].includes(r)
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Task[]>([]),
    [card, setCard] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Row[]>([]),
    [people, setPeople] = useState<Row[]>([]);
  const [preparingCreation, setPreparingCreation] = useState(false);
  const [creating, setCreating] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [reporting, setReporting] = useState(false);
  const [replacements, setReplacements] = useState<Row[]>([]);
  const [templateOptions, setTemplateOptions] = useState<Row[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDirty, setReportDirty] = useState(false);
  const [problemReporting, setProblemReporting] = useState(false);
  const [works, setWorks] = useState<Row[]>([]);
  const [createForm] = Form.useForm(), [actionForm] = Form.useForm();
  const generation = useRef(0), key = useRef(crypto.randomUUID());
  const requestId = Form.useWatch("request_id", createForm);
  const commonId = Form.useWatch("common_work_id", createForm);
  async function refresh(preserveCard = false) {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    if (!preserveCard) setCard(null);
    try {
      const result = await apiFetch<{ items: Task[] }>("/v1/tasks");
      if (current === generation.current) setRows(result.items);
    } catch (e) {
      if (current === generation.current) {
        setRows([]);
        setError(message(e));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  usePageRefresh(() => refresh(true), !loading && !saving && !actionLoading && !reportBusy);
  useEffect(() => {
    setAssigneeFilter(undefined);
    setSearch("");
    setStateFilter(undefined);
    setFrom("");
    setTo("");
    setCreating(false);
    setAction(null);
    setReporting(false);
    setRequests([]);
    setPeople([]);
    let active = true;
    void refresh().then(() => {
      if (!active || !identity?.me.person.id) return;
      const query = new URLSearchParams(window.location.search);
      const taskId = query.get("task"), workId = query.get("common_work");
      if (!taskId && !workId) return;
      if (workId && !manager) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("task"); url.searchParams.delete("common_work");
      window.history.replaceState(null, "", url);
      if (taskId) void open(taskId);
      else if (workId) void newTask(workId);
    });
    return () => {
      active = false;
      generation.current++;
    };
  }, [identity?.me.person.id]);
  useEffect(() => {
    let active = true;
    setPeople([]);
    createForm.setFieldValue("assignee_person_id", undefined);
    if (requestId || commonId) {
      void apiFetch<{ items: Row[] }>(
        commonId
          ? `/v1/common-works/${commonId}/task-assignees`
          : `/v1/requests/${requestId}/task-assignees`,
      ).then((r) => {
        if (active) setPeople(r.items);
      }).catch((e) => {
        if (active) setError(message(e));
      });
    }
    return () => {
      active = false;
    };
  }, [requestId, commonId, createForm]);
  async function open(id: string, preserveCard = false) {
    const current = ++generation.current;
    if (!preserveCard) setCard(null);
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<Task>(`/v1/tasks/${id}`);
      if (current === generation.current) setCard(result);
    } catch (e) {
      if (current === generation.current) { setCard(null); setError(message(e)); }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function newTask(commonWorkId?: string) {
    if (preparingCreation) return;
    setError(null);
    setPreparingCreation(true);
    try {
      const [result, common] = await Promise.all([
        apiFetch<{ items: Row[] }>("/v1/requests"),
        apiFetch<{ items: Row[] }>("/v1/common-works"),
      ]);
      setWorks(
        common.items.filter((w) =>
          !["completed", "canceled"].includes(String(w.state))
        ),
      );
      setRequests(
        result.items.filter((r) =>
          r.can_manage &&
          !["draft", "closed", "canceled", "rejected", "awaiting_confirmation"]
            .includes(String(r.state))
        ),
      );
      createForm.resetFields();
      if (commonWorkId) {
        createForm.setFieldValue("common_work_id", commonWorkId);
      }
      key.current = crypto.randomUUID();
      setCreating(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setPreparingCreation(false);
    }
  }
  async function beginAction(value: string) {
    setError(null);
    actionForm.resetFields();
    key.current = crypto.randomUUID();
    setAction(value);
    setActionLoading(true);
    setReplacements([]);
    setTemplateOptions([]);
    try {
      if (value === "revise_template") {
        try {
          setTemplateOptions(
            (await apiFetch<{ items: Row[] }>("/v1/job-templates")).items.filter(
              (t) => t.active,
            ),
          );
        } catch (e) {
          setError(message(e));
        }
      }
      if (["cancel", "replace_canceled"].includes(value) && card) {
        try {
          const r = await apiFetch<{ items: Row[] }>("/v1/tasks");
          setReplacements(
            r.items.filter((t) =>
              t.id !== card.id && t.request_id === card.request_id &&
              t.common_work_id === card.common_work_id && t.is_required &&
              t.state !== "canceled"
            ),
          );
        } catch (e) {
          setError(message(e));
        }
      }
      if (value === "assign" && card) {
        setPeople([]);
        try {
          setPeople(
            (await apiFetch<{ items: Row[] }>(
              card.common_work_id
                ? `/v1/common-works/${card.common_work_id}/task-assignees`
                : `/v1/requests/${card.request_id}/task-assignees`,
            )).items,
          );
        } catch (e) {
          setError(message(e));
        }
      }
    } finally { setActionLoading(false); }
  }
  async function save(values: Row) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Row = { ...values };
      if (action === "revise_template") {
        body.template_version = templateOptions.find((t) =>
          t.id === values.template_id
        )?.version;
      }
      for (const date of ["due_at", "next_action_at", "rework_due_at"]) {
        if (body[date]) body[date] = new Date(String(body[date])).toISOString();
      }
      const result = creating
        ? await apiFetch<Task>("/v1/tasks", {
          method: "POST",
          body,
          idempotencyKey: key.current,
        })
        : await apiFetch<Task>(`/v1/tasks/${card!.id}/transitions`, {
          method: "POST",
          body: {
            ...body,
            action,
            version: card!.version,
            ...(["approve", "return"].includes(action ?? "")
              ? { report_version: latestReport?.version }
              : {}),
          },
          idempotencyKey: key.current,
        });
      await refresh(true);
      await open(result.id, true);
      setCreating(false);
      setAction(null);
    } catch (e) {
      setError(message(e));
      if (isVersionConflict(e) && card) {
        try {
          setCard(await apiFetch<Task>(`/v1/tasks/${card.id}`));
          setError(VERSION_CONFLICT_MESSAGE);
        } catch (refreshError) { setError(message(refreshError)); }
      }
    } finally {
      setSaving(false);
    }
  }

  const workerActions = card?.can_execute
    ? ({
      awaiting_acceptance: ["accept", "decline"],
      accepted: ["start", "request_pause"],
      in_progress: ["request_pause"],
      rework: ["start"],
    } as Record<string, string[]>)[card.state] ?? []
    : [];
  const adminActions = card?.can_manage
    ? [
      ...(card.state === "created" ? ["assign"] : []),
      ...(card.state === "canceled" && card.is_required
        ? ["replace_canceled"]
        : []),
      ...(!["accepted_admin", "canceled", "on_review"].includes(card.state)
        ? ["revise_template"]
        : []),
      ...(!["accepted_admin", "canceled"].includes(card.state)
        ? ["cancel"]
        : []),
      ...(["accepted", "in_progress"].includes(card.state) ? ["suspend"] : []),
      ...(card.state === "suspended" ? ["resume"] : []),
      ...(!["accepted_admin", "canceled", "created"].includes(card.state)
        ? ["reassign"]
        : []),
    ]
    : [];
  const reasonNeeded = action &&
    [
      "replace_canceled",
      "request_pause",
      "decline",
      "suspend",
      "resume",
      "reassign",
      "return",
      "cancel",
      "revise_template",
    ].includes(
      action,
    );
  const reports = (card?.reports as Row[]) ?? [];
  const latestReport = reports[reports.length - 1];
  // API возвращает ошибки доставки от новых к старым.
  const latestDeliveryFailure = card?.delivery_failures?.[0];
  if (card?.can_manage && card.state === "on_review") {
    if (card.can_approve === true) adminActions.push("approve");
    adminActions.push("return");
  }
  if (card?.can_manage && card.state === "accepted_admin") {
    adminActions.push("return");
  }
  const assignees = new Map<string, string>();
  for (const task of rows) {
    if (task.assignee_person_id) assignees.set(task.assignee_person_id, task.assignee_name ?? "Имя не указано");
  }
  const assigneeOptions = [...assignees].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  const query = search.trim().toLocaleLowerCase("ru");
  const fromTime = from ? Date.parse(`${from}T00:00:00+05:00`) : null;
  const toTime = to ? Date.parse(`${to}T23:59:59.999+05:00`) : null;
  const invalidPeriod = !!(from && to && from > to);
  const visibleRows = rows.filter(task => {
    const created = Date.parse(task.created_at ?? "");
    return !invalidPeriod &&
      (!query || [task.number, task.title, task.instruction].some(value => value?.toLocaleLowerCase("ru").includes(query))) &&
      (!assigneeFilter || (assigneeFilter === "unassigned" ? !task.assignee_person_id : task.assignee_person_id === assigneeFilter)) &&
      (!stateFilter || task.state === stateFilter) &&
      (fromTime === null || created >= fromTime) && (toTime === null || created <= toTime);
  });
  const tableColumns: TableColumnsType<Task> = [
    {
      title: "Номер",
      key: "number", dataIndex: "number",
      render: (n: string, r: Task) => (
        <Button
          type="link"
          onClick={() => void open(r.id)}
        >
          {n}
        </Button>
      ),
    },
    {
      key: "request", title: "Обращение",
      render: (_, task) => task.linked_request
        ? <Typography.Link href={`/requests?request=${encodeURIComponent(task.linked_request.id)}`}>{task.linked_request.number}</Typography.Link>
        : "—",
    },
    { title: "Работа", key: "title", dataIndex: "title" },
    { title: "Исполнитель", key: "assignee_name", dataIndex: "assignee_name", render: (name: string | null) => name ?? "Не назначен" },
    {
      title: "Состояние",
      key: "state", dataIndex: "state",
      render: (s: string) => <Tag>{TASK_STATE_TEXT[s]?.ru ?? s}</Tag>,
    },
    {
      title: "Дата создания",
      key: "created_at", dataIndex: "created_at",
      render: (value?: string) => value ? new Date(value).toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      }) : "—",
    },
    {
      title: "Срок",
      key: "due_at", dataIndex: "due_at",
      render: (v: string) => new Date(v).toLocaleString("ru-RU"),
    },
  ];
  const taskActions = card && (
          <ProcessActions primary={taskGuidance(card).primary}>
            {card.can_execute && card.state === "in_progress" && (
              <Button key="problem"
                onClick={() => {
                  setReportDirty(false);
                  setProblemReporting(true);
                  setReporting(true);
                }}
              >
                Найдена проблема
              </Button>
            )}
            {card.can_execute && card.state === "in_progress" && (
              <Button key="report"
                onClick={() => {
                  setReportDirty(false);
                  setProblemReporting(false);
                  setReporting(true);
                }}
              >
                Отправить отчёт
              </Button>
            )}
            {[...workerActions, ...adminActions].map((a) => (
              <Button
                key={a}
                onClick={() => void beginAction(a)}
              >
                {TASK_ACTION_TEXT[a]}
              </Button>
            ))}
          </ProcessActions>
  );
  const renderTaskReport = (r: Row) => (
              <List.Item>
                <Space direction="vertical">
                  <Typography.Text strong>
                    {r === latestReport ? "Текущий отчёт · версия " : "Предыдущий отчёт · версия "}{String(r.version)}
                  </Typography.Text>
                  <Typography.Text>
                    {String(r.performed_work)} — {String(r.result)}
                  </Typography.Text>
                  <Typography.Text>{String(r.limitations)}</Typography.Text>
                  {((r.evidence as Row[]) ?? []).map((e) => (
                    <div key={String(e.requirementId)}>
                      {String(e.requirementId)}: {String(e.missingReason ?? "")}
                      {((e.attachmentIds as string[]) ?? []).map((id) => (
                        <Button
                          key={id}
                          disabled={false}
                          onClick={async () => {
                            try {
                              const f = await apiFetch<{ url: string }>(
                                `/v1/files/${id}/url`,
                              );
                              window.open(
                                f.url,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            } catch (err) {
                              setError(message(err));
                            }
                          }}
                        >
                          Открыть файл
                        </Button>
                      ))}
                    </div>
                  ))}
                </Space>
              </List.Item>
  );
  const taskReports = card && (
          <DetailSection title="Отчёты"><div id="task-reports">
          <List
            dataSource={latestReport ? [latestReport] : []}
            locale={{ emptyText: "Отчётов пока нет" }}
            renderItem={renderTaskReport}
          />
          </div>
          {card.state === "on_review" && taskActions}
          {reports.length > 1 && <details><summary>Предыдущие отчёты ({reports.length - 1})</summary>
            <List dataSource={reports.slice(0, -1).reverse()} renderItem={renderTaskReport} />
          </details>}
          </DetailSection>
  );
  return (
    <PageLayout title="Все задания"
      extra={<ViewToggle kind={view} onChange={setView} />}
      actions={manager ? <Button type="primary" onClick={() => void newTask()}>Создать задание</Button> : null}
      filters={<Space wrap>
        <Input.Search aria-label="Поиск заданий" placeholder="Номер или описание"
          value={search} onChange={event => setSearch(event.target.value)} style={{ width: 280, maxWidth: "100%" }} />
        <Select
          aria-label="Фильтр по исполнителю"
          placeholder="Все исполнители"
          allowClear
          showSearch
          optionFilterProp="label"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[{ value: "unassigned", label: "Без исполнителя" }, ...assigneeOptions]}
          style={{ width: 280, maxWidth: "100%" }}
        />
        <Select aria-label="Состояние задания" placeholder="Все состояния" allowClear
          value={stateFilter} onChange={setStateFilter} options={BOARD_COLUMNS} style={{ width: 230 }} />
        <Space wrap>
        <Typography.Text type="secondary">Дата создания:</Typography.Text>
        <Input aria-label="Дата создания с" title="Дата создания с (Алматы)" type="date"
          value={from} onChange={event => setFrom(event.target.value)} style={{ width: 155 }} />
        <Input aria-label="Дата создания по" title="Дата создания по (Алматы)" type="date"
          value={to} onChange={event => setTo(event.target.value)} style={{ width: 155 }} />
        </Space>
      </Space>}>

      {invalidPeriod && <Alert type="warning" showIcon message="Дата начала периода позже даты окончания" />}
      {error && !card && !creating && <Alert type="error" showIcon message={error} />}

      {view === "board" ? (
        <BoardView
          columns={BOARD_COLUMNS}
          rows={visibleRows}
          stateOf={(t) => t.state}
          onOpen={(t) => void open(t.id)}
          selectedId={card ? card.id : null}
          loading={loading}
          emptyText="Доступных заданий нет"
          renderCard={(t) => (
            <>
              <Typography.Text strong>{t.number}</Typography.Text>
              <Typography.Paragraph
                ellipsis={{ rows: 2 }}
                style={{ marginBottom: 4 }}
              >
                {t.title}
              </Typography.Paragraph>
              <Typography.Text type="secondary" style={{ display: "block" }}>
                Исполнитель: {t.assignee_name ?? "не назначен"}
              </Typography.Text>
              <Typography.Text
                type={overdue(t) ? "danger" : "secondary"}
                style={{ display: "block" }}
              >
                {`Срок: ${new Date(t.due_at).toLocaleString("ru-RU")}`}
              </Typography.Text>
            </>
          )}
        />
      ) : (
        <ConfigurableTable<Task> storageKey="columns.tasks" settingsPlacement="page"
          loading={loading}
          rowKey="id"
          dataSource={visibleRows}
          locale={{ emptyText: "Доступных заданий нет" }}
          scroll={{ x: 650 }}
          columns={tableColumns}
        />
      )}
      <CardDrawer
        open={!!card || creating || !!action || reporting}
        title={card ? `${card.number} — ${card.title}` : "Новое задание"}
        closeDisabled={saving || reportBusy || actionLoading}
        onClose={() => {
          // Отзыв закрывает карточку окончательно: незавершённый open() её не вернёт.
          generation.current++;
          setCard(null);
          setCreating(false);
        }}
      >
        {error && card && !action && !creating && !reporting && <Alert role="alert" type="error" showIcon message={error} />}
        {card && (
          <div key={String(card.id)} className="process-card-content">
          {latestDeliveryFailure && (
            <Alert
              role="alert"
              aria-label="Ошибка доставки уведомления"
              type="error"
              showIcon
              message={<Space wrap><span>{latestDeliveryFailure.last_error === "BLOCKED_BY_USER"
                ? "Бот заблокирован получателем"
                : latestDeliveryFailure.last_error === "DISPATCH_FAILED"
                ? "Не удалось подготовить уведомление"
                : "Доставка не удалась"}</span>
                <Typography.Text type="secondary">{latestDeliveryFailure.followup_state === "done" ? "Связь: результат записан" : "Связь: требуется связаться"}</Typography.Text>
                <Typography.Link href="/notifications/failures">Журнал доставки</Typography.Link>
              </Space>}
            />
          )}
          {!!card.overdue_at && overdue(card) && <Alert type="warning" showIcon message={`Срок нарушен с ${new Date(String(card.overdue_at)).toLocaleString("ru-RU")}`} />}
          <ProcessOverview participantLabel="Исполнитель" participant={card.assignee_name} guidance={taskGuidance(card)} state={TASK_STATE_TEXT[card.state]?.ru}
            due={card.state === "awaiting_acceptance" ? card.acceptance_due_at ?? card.due_at : card.due_at}>
            {card.state === "on_review"
              ? <Button type="link" href="#task-reports">Перейти к отчёту</Button>
              : taskActions}
          </ProcessOverview>
          {card.state === "on_review" && taskReports}
          <DetailSection title="Информация о задании">
          {!!card.linked_request && <Typography.Paragraph>
            Обращение: <Typography.Link href={`/requests?request=${encodeURIComponent(String((card.linked_request as Row).id))}`}>
              {String((card.linked_request as Row).number)}
            </Typography.Link>
          </Typography.Paragraph>}
          <Descriptions
            column={1}
            items={[{
              key: "created",
              label: "Дата создания",
              children: card.created_at ? new Date(card.created_at).toLocaleString("ru-RU", {timeZone:"Asia/Almaty"}) : "Не указана",
            }, {
              key: "required",
              label: "Объём",
              children: card.is_required === true ? "Обязательное задание" : card.is_required === false ? "Дополнительное задание" : "Не указан",
            }]}
          />
          {!!card.acceptance_due_at && card.state === "awaiting_acceptance" && <p>Ожидаем принятия до {new Date(String(card.acceptance_due_at)).toLocaleString("ru-RU")}</p>}
          </DetailSection>
          <DetailSection title="Инструкция">
            <Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{card.instruction}</Typography.Paragraph>
            {!!card.methodology && <Typography.Text type="secondary">
              Методичка, версия {String((card.methodology as Row).version)} · {String((card.methodology as Row).author_name)} · {new Date(String((card.methodology as Row).created_at)).toLocaleDateString("ru-RU",{timeZone:"Asia/Almaty"})}
            </Typography.Text>}
          </DetailSection>
          {roles.some(r => r !== "tech_admin") && <DetailSection title="Комплект документов"><DocumentObligationSummary kind="task" id={String(card.id)} actRequired={card.document_required === true} /></DetailSection>}
          <TaskProblems task={card} onSaved={() => open(card.id, true)} />
          {card.state !== "on_review" && taskReports}
          <ProcessHistory title="История задания">
          <List
            dataSource={card.log ?? []}
            locale={{ emptyText: "Событий пока нет" }}
            renderItem={(item) => (
              <List.Item>
                {new Date(String(item.at)).toLocaleString("ru-RU")} —{" "}
                {TASK_STATE_TEXT[String(item.to_state)]?.ru}
                {item.reason ? `: ${String(item.reason)}` : ""}
              </List.Item>
            )}
          />
          </ProcessHistory>
          </div>
        )}
      <ActionPanel
        hasUnsavedChanges={() => reportDirty}
        busy={reportBusy}
        full
        error={error}
        description={problemReporting ? "Проблема будет сохранена с местом и материалами. Администратор, заместитель или председатель ОСИ отдельно определит дальнейшее задание." : "Отчёт с доказательствами будет отправлен на проверку. Завершение исполнения не означает приёмку администратором, заместителем или председателем ОСИ."}
        title={problemReporting ? "Найденная проблема" : "Отчёт исполнителя"}
        open={reporting}
        onCancel={() => setReporting(false)}
      >
        {card && (
          <TaskReportForm
            onConflict={async () => { setCard(await apiFetch<Task>("/v1/tasks/" + card.id)); }}
            onBusyChange={setReportBusy}
            onDirtyChange={setReportDirty}
            problem={problemReporting}
            key={card.id + ":" + problemReporting}
            task={card}
            onSaved={async () => {
              await open(card.id, true);
              setReporting(false);
            }}
          />
        )}
      </ActionPanel>
      <ActionPanel
        form={createForm}
        full
        error={error}
        busy={saving}
        title="Новое задание"
        open={creating}
        onCancel={() => {
          if (!saving) setCreating(false);
        }}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(v) => void save(v)}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
          initialValues={{ is_required: true }}
        >
          <Form.Item
            name="request_id"
            label="Обращение"
            rules={commonId ? [] : required}
          >
            <Select
              showSearch
              optionFilterProp="label"
              allowClear
              onChange={() =>
                createForm.setFieldValue("common_work_id", undefined)}
              options={requests.map((r) => ({
                value: r.id,
                label: `${r.number} — ${r.description}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="common_work_id"
            label="Или общая работа"
            rules={requestId ? [] : required}
          >
            <Select
              allowClear
              onChange={() => createForm.setFieldValue("request_id", undefined)}
              options={works.map((w) => ({
                value: w.id,
                label: `${w.number} — ${w.title}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="Объём работы" rules={required}>
            <Input maxLength={300} />
          </Form.Item>
          <Form.Item name="instruction" label="Инструкция" rules={required}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="due_at"
            label="Срок (местное время)"
            rules={required}
          >
            <DeadlineInput />
          </Form.Item>
          <Form.Item name="assignee_person_id" label="Исполнитель">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              notFoundContent="Нет действующих сотрудников ОСИ"
              options={taskAssigneeOptions(people)}
            />
          </Form.Item>
          <Form.List name="required_evidence">
            {(fields, { add, remove }) => (
              <>
                <Typography.Text>Доказательства по чек-листу</Typography.Text>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline">
                    <Form.Item name={[field.name, "id"]} rules={required}>
                      <Input
                        placeholder="Например, фото результата"
                        aria-label="Пункт чек-листа"
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "kind"]}>
                      <Select
                        aria-label="Вид доказательства"
                        options={[{ value: "file", label: "Файл" }, {
                          value: "photo",
                          label: "Фото",
                        }]}
                        style={{ width: 100 }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "required"]}
                      valuePropName="checked"
                    >
                      <Checkbox>Обязательно</Checkbox>
                    </Form.Item>
                    <Button onClick={() => remove(field.name)}>Убрать</Button>
                  </Space>
                ))}
                <Button onClick={() => add({ required: true })}>
                  Добавить доказательство
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="access_required" valuePropName="checked">
            <Checkbox disabled={!!commonId}>
              Перед началом согласовать доступ
            </Checkbox>
          </Form.Item>
          <Form.Item name="document_required" valuePropName="checked">
            <Checkbox>Для результата требуется акт</Checkbox>
          </Form.Item>
          <Form.Item name="is_required" valuePropName="checked">
            <Checkbox>Обязательно для результата обращения</Checkbox>
          </Form.Item>
          <Button style={{ position: "sticky", bottom: 0, zIndex: 1, marginBlock: token.marginSM }} htmlType="submit" type="primary" loading={saving}>
            Создать
          </Button>
        </Form>
      </ActionPanel>
      <ActionPanel
        description={processActionHint("task", action)}
        form={actionForm}
        error={error}
        busy={saving || actionLoading}
        full={!!action && ["cancel", "replace_canceled", "revise_template"].includes(action)}
        title={action ? TASK_ACTION_TEXT[action] : "Действие"}
        open={!!action}
        onCancel={() => {
          if (!saving) setAction(null);
        }}
      >
        <Form
          form={actionForm}
          layout="vertical"
          onFinish={(v) => void save(v)}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
        >
          {action === "assign" && (
            <Form.Item
              name="assignee_person_id"
              label="Исполнитель"
              rules={required}
            >
              <Select
                showSearch
                optionFilterProp="label"
                notFoundContent="Нет действующих сотрудников ОСИ"
                options={taskAssigneeOptions(people)}
              />
            </Form.Item>
          )}
          {action === "approve" && (
            <>
              <Form.Item
                name="result_checked"
                valuePropName="checked"
                rules={[{
                  validator: (_, v) =>
                    v
                      ? Promise.resolve()
                      : Promise.reject(new Error("Подтвердите проверку")),
                }]}
              >
                <Checkbox>Результат и чек-лист проверены</Checkbox>
              </Form.Item>
              {((latestReport?.missing_evidence as string[]) ?? []).map((
                id,
                i,
              ) => (
                <div key={id}>
                  <Form.Item
                    name={["evidence_decisions", i, "requirement_id"]}
                    initialValue={id}
                    hidden
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name={["evidence_decisions", i, "reason"]}
                    label={`Решение по отсутствующему доказательству: ${id}`}
                    rules={required}
                  >
                    <Input.TextArea />
                  </Form.Item>
                </div>
              ))}
            </>
          )}
          {action === "return" && (
            <>
              <Form.Item
                name="expected_result"
                label="Ожидаемый результат исправления"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
              <Form.Item
                name="rework_due_at"
                label="Срок исправления"
                rules={required}
              >
                <DeadlineInput />
              </Form.Item>
              {card?.state === "accepted_admin" && (
                <Form.Item
                  name="dependency_review"
                  label="Влияние возврата на зависимые задания"
                  rules={required}
                >
                  <Input.TextArea />
                </Form.Item>
              )}
            </>
          )}
          {action === "revise_template" && (
            <>
              <Alert
                type="info"
                message="Срок и выполненные материалы сохранятся. Исполнитель будет уведомлён; задание потребуется назначить и принять заново."
              />
              <Form.Item
                name="template_id"
                label="Новая методичка"
                rules={required}
              >
                <Select
                  options={templateOptions.map((t) => ({
                    value: t.id,
                    label: `${t.name}, версия ${t.version}`,
                  }))}
                />
              </Form.Item>
            </>
          )}
          {action && ["cancel", "replace_canceled"].includes(action) && (
            <>
              <Form.Item
                name="stop_checked"
                valuePropName="checked"
                rules={[{
                  validator: (_, v) =>
                    v ? Promise.resolve() : Promise.reject(
                      new Error("Подтвердите проверку остановки"),
                    ),
                }]}
              >
                <Checkbox>
                  Остановка и влияние на зависимые работы проверены
                </Checkbox>
              </Form.Item>
              {!!card?.is_required && (
                <Form.Item
                  name="replacement_task_id"
                  label="Обязательное заменяющее задание"
                  rules={required}
                >
                  <Select
                    options={replacements.map((t) => ({
                      value: t.id,
                      label: `${t.number} — ${t.title}`,
                    }))}
                  />
                </Form.Item>
              )}
              <Form.Item
                name="dependency_review"
                label="Влияние на уже начатые зависимые работы"
              >
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {reasonNeeded && (
            <Form.Item
              name="reason"
              label="Причина / основание"
              rules={required}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "suspend" && (
            <>
              <Form.Item
                name="next_action"
                label="Следующее действие"
                rules={required}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="next_action_at"
                label="Дата следующего действия"
                rules={required}
              >
                <DeadlineInput />
              </Form.Item>
            </>
          )}
          <Button style={{ position: "sticky", bottom: 0, zIndex: 1, marginBlock: token.marginSM }} htmlType="submit" type="primary" loading={saving}>
            {action ? TASK_ACTION_TEXT[action] : "Подтвердить"}
          </Button>
        </Form>
      </ActionPanel>
      </CardDrawer>

    </PageLayout>
  );
}
