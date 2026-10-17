import { TaskProblems } from "./task-problems";
import { JobTemplates } from "./job-templates";
import { CommonWorks } from "./common-works";
import { TaskVisits } from "./task-visits";
import { TaskReportForm } from "./task-report";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
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
  request_id: string;
  can_manage?: boolean;
  can_approve?: boolean;
  can_execute?: boolean;
  log?: Row[];
  delivery_failures?: {id:string;last_error:string;followup_state:string}[];
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Ошибка запроса";
const required = [{ required: true, message: "Заполните поле" }];
export function TasksPage() {
  const { identity, roles } = useCabinetIdentity();
  const manager = roles.some((r) =>
    ["chairman", "administrator", "deputy"].includes(r)
  );
  const [rows, setRows] = useState<Task[]>([]),
    [card, setCard] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Row[]>([]),
    [people, setPeople] = useState<Row[]>([]);
  const [creating, setCreating] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [reporting, setReporting] = useState(false);
  const [replacements, setReplacements] = useState<Row[]>([]);
  const [templateOptions, setTemplateOptions] = useState<Row[]>([]);
  const [problemReporting, setProblemReporting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [commonOpen, setCommonOpen] = useState(false),
    [works, setWorks] = useState<Row[]>([]);
  const [createForm] = Form.useForm(), [actionForm] = Form.useForm();
  const generation = useRef(0), key = useRef(crypto.randomUUID());
  const requestId = Form.useWatch("request_id", createForm);
  const commonId = Form.useWatch("common_work_id", createForm);
  async function refresh() {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setCard(null);
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
  useEffect(() => {
    setCreating(false);
    setCommonOpen(false);
    setTemplatesOpen(false);
    setAction(null);
    setReporting(false);
    setRequests([]);
    setPeople([]);
    void refresh();
    return () => {
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
  async function open(id: string) {
    const current = ++generation.current;
    setCard(null);
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<Task>(`/v1/tasks/${id}`);
      if (current === generation.current) setCard(result);
    } catch (e) {
      if (current === generation.current) setError(message(e));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function newTask(commonWorkId?: string) {
    setError(null);
    setLoading(true);
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
      setCommonOpen(false);
      key.current = crypto.randomUUID();
      setCreating(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function beginAction(value: string) {
    setError(null);
    actionForm.resetFields();
    key.current = crypto.randomUUID();
    setAction(value);
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
      setCreating(false);
      setAction(null);
      await refresh();
      await open(result.id);
    } catch (e) {
      setError(message(e));
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
  if (card?.can_manage && card.state === "on_review") {
    if (card.can_approve === true) adminActions.push("approve");
    adminActions.push("return");
  }
  if (card?.can_manage && card.state === "accepted_admin") {
    adminActions.push("return");
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={2}>Задания</Typography.Title>
      {manager && (
        <Space>
          <Button onClick={() => setCommonOpen(true)}>Общие работы</Button>
          <Button onClick={() => setTemplatesOpen(true)}>
            Шаблоны заданий
          </Button>
        </Space>
      )}
      <Modal
        title="Шаблоны заданий"
        open={templatesOpen}
        onCancel={() => setTemplatesOpen(false)}
        footer={null}
        width={1000}
        destroyOnHidden
      >
        {templatesOpen && (
          <JobTemplates
            onCreated={(id) => {
              setTemplatesOpen(false);
              void refresh().then(() => open(id));
            }}
          />
        )}
      </Modal>
      <Modal
        title="Общие работы"
        open={commonOpen}
        onCancel={() => setCommonOpen(false)}
        footer={null}
        width={1000}
        destroyOnHidden
      >
        {commonOpen && <CommonWorks onTask={(id) => void newTask(id)} />}
      </Modal>
      {error && <Alert type="error" showIcon message={error} />}
      <Space wrap>
        <Button onClick={() => void refresh()} loading={loading}>
          Обновить
        </Button>
        {manager && (
          <Button
            type="primary"
            onClick={() => void newTask()}
            disabled={loading}
          >
            Создать задание
          </Button>
        )}
      </Space>
      <Table<Task>
        loading={loading}
        rowKey="id"
        dataSource={rows}
        locale={{ emptyText: "Доступных заданий нет" }}
        scroll={{ x: 650 }}
        columns={[
          {
            title: "Номер",
            dataIndex: "number",
            render: (n: string, r: Task) => (
              <Button
                type="link"
                onClick={() => void open(r.id)}
              >
                {n}
              </Button>
            ),
          },
          { title: "Работа", dataIndex: "title" },
          {
            title: "Состояние",
            dataIndex: "state",
            render: (s: string) => <Tag>{TASK_STATE_TEXT[s] ?? s}</Tag>,
          },
          {
            title: "Срок",
            dataIndex: "due_at",
            render: (v: string) => new Date(v).toLocaleString("ru-RU"),
          },
        ]}
      />
      {card && (
        <Card title={`${card.number} — ${card.title}`}>
          <Descriptions
            column={1}
            items={[{
              key: "state",
              label: "Состояние",
              children: TASK_STATE_TEXT[card.state],
            }, {
              key: "instruction",
              label: "Инструкция",
              children: (
                <>
                  {card.instruction}
                  {!!card.methodology && (
                    <p>
                      Методичка, версия{" "}
                      {String((card.methodology as Row).version)};{" "}
                      {String((card.methodology as Row).author_name)};{" "}
                      {new Date(String((card.methodology as Row).created_at))
                        .toLocaleDateString()}
                    </p>
                  )}
                </>
              ),
            }, {
              key: "due",
              label: "Срок",
              children: new Date(card.due_at).toLocaleString("ru-RU"),
            }]}
          />
          {!!card.overdue_at && <Alert type="warning" showIcon message={`Срок нарушен с ${new Date(String(card.overdue_at)).toLocaleString("ru-RU")}`} />}
          {!!card.acceptance_due_at && card.state === "awaiting_acceptance" && <p>Ожидаем принятия до {new Date(String(card.acceptance_due_at)).toLocaleString("ru-RU")}</p>}
          {card.delivery_failures?.map(f => <Alert key={f.id} type="error" showIcon message={`Ошибка доставки: ${f.last_error}`} description={`Связь: ${f.followup_state === "done" ? "результат записан" : "требуется связаться"}. Подробности — в разделе «Уведомления».`} />)}
          <TaskProblems task={card} onSaved={() => open(card.id)} />
          <Space wrap>
            {card.can_execute && card.state === "in_progress" && (
              <Button
                onClick={() => {
                  setProblemReporting(true);
                  setReporting(true);
                }}
              >
                Найдена проблема
              </Button>
            )}
            {card.can_execute && card.state === "in_progress" && (
              <Button
                onClick={() => {
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
          </Space>
          <TaskVisits task={card} onChanged={() => open(card.id)} />
          <Typography.Title level={3}>Отчёты</Typography.Title>
          <List
            dataSource={reports}
            locale={{ emptyText: "Отчётов пока нет" }}
            renderItem={(r) => (
              <List.Item>
                <Space direction="vertical">
                  <Typography.Text strong>
                    Версия {String(r.version)}
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
            )}
          />
          <Typography.Title level={3}>История задания</Typography.Title>
          <List
            dataSource={card.log ?? []}
            locale={{ emptyText: "Событий пока нет" }}
            renderItem={(item) => (
              <List.Item>
                {new Date(String(item.at)).toLocaleString("ru-RU")} —{" "}
                {TASK_STATE_TEXT[String(item.to_state)]}
                {item.reason ? `: ${String(item.reason)}` : ""}
              </List.Item>
            )}
          />
        </Card>
      )}
      <Modal
        title={problemReporting ? "Найденная проблема" : "Отчёт исполнителя"}
        open={reporting}
        onCancel={() => setReporting(false)}
        footer={null}
        destroyOnHidden
      >
        {card && (
          <TaskReportForm
            problem={problemReporting}
            key={`${card.id}:${card.version}`}
            task={card}
            onSaved={async () => {
              setReporting(false);
              await open(card.id);
            }}
          />
        )}
      </Modal>
      <Modal
        title="Новое задание"
        open={creating}
        onCancel={() => {
          if (!saving) setCreating(false);
        }}
        footer={null}
        destroyOnHidden
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
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="assignee_person_id" label="Исполнитель">
            <Select
              allowClear
              options={people.map((p) => ({
                value: p.id,
                label: String(p.full_name),
              }))}
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
          <Button htmlType="submit" type="primary" loading={saving}>
            Создать
          </Button>
        </Form>
      </Modal>
      <Modal
        title={action ? TASK_ACTION_TEXT[action] : "Действие"}
        open={!!action}
        onCancel={() => {
          if (!saving) setAction(null);
        }}
        footer={null}
        destroyOnHidden
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
                options={people.map((p) => ({
                  value: p.id,
                  label: String(p.full_name),
                }))}
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
                <Input type="datetime-local" />
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
                <Input type="datetime-local" />
              </Form.Item>
            </>
          )}
          <Button htmlType="submit" type="primary" loading={saving}>
            {action ? TASK_ACTION_TEXT[action] : "Подтвердить"}
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
