import { PROCESS_MANAGER_ROLES } from "../components/process-guidance";
import { DeadlineInput } from "../components/deadline-input";
import { ProcessOverview } from "../components/process-card";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import { CardDrawer } from "./card-drawer";
import { JobSchedule } from "./job-schedule";
import { DocumentRuleFields } from "./document-rule-fields";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  List,
  Select,
  Space,
  Typography,
  theme,
} from "antd";
import { apiFetch } from "../lib/api";
import { OSI_PRESETS, type TemplatePreset } from "./job-template-presets";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
export function JobTemplates(
  { onCreated }: { onCreated: (taskId: string) => void },
) {
  const { token } = theme.useToken();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]),
    [buildings, setBuildings] = useState<Row[]>([]),
    [versions, setVersions] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [schedule,setSchedule]=useState<Row|null>(null);
  const [form] = Form.useForm();
  const [people, setPeople] = useState<{ id: unknown; full_name?: unknown }[]>([]);
  const key = useRef(crypto.randomUUID()), generation = useRef(0);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function refresh() {
    const g = ++generation.current;
    setBusy(true);
    try {
      const [templates, bs] = await Promise.all([
        apiFetch<{ items: Row[] }>("/v1/job-templates"),
        apiFetch<{ items: Row[] }>("/v1/registry/buildings"),
      ]);
      if (g === generation.current) {
        setRows(templates.items);
        setBuildings(bs.items);
      }
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  usePageRefresh(refresh, !busy && !scheduleBusy);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!action) return;
    let active = true;
    void apiFetch<{ items: { id: unknown; full_name?: unknown }[] }>("/v1/documents/candidates")
      .then(result => { if (active) setPeople(result.items ?? []); }, e => { if (active) fail(e); });
    return () => { active = false; };
  }, [action]);
  function begin(value: string, row: Row | null) {
    setSelected(row);
    setError(null);
    setAction(value);
    form.resetFields();
    key.current = crypto.randomUUID();
    if (row && value === "edit") {
      form.setFieldsValue({ ...row, ...row.blueprint as Row });
    }
  }
  function beginPreset(p: TemplatePreset) {
    begin("create", null);
    form.setFieldsValue({
      name: p.name,
      title: p.title,
      instruction: p.instruction,
      required_evidence: p.evidence.map((e) => ({ ...e })),
    });
  }
  async function history(row: Row) {
    const g = ++generation.current;
    setSelected(row);
    setVersions([]);
    setBusy(true);
    try {
      const r = await apiFetch<{ items: Row[] }>(
        `/v1/job-templates/${row.id}/versions`,
      );
      if (g === generation.current) setVersions(r.items);
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function save(values: Row) {
    setBusy(true);
    setError(null);
    try {
      const body: Row = { ...values, version: selected?.version };
      if (body.due_at) {
        body.due_at = new Date(String(body.due_at)).toISOString();
      }
      const r = await apiFetch<Row>(
        `/v1/job-templates${
          action === "create"
            ? ""
            : `/${selected!.id}${action === "run" ? "/run" : ""}`
        }`,
        {
          method: action === "edit" ? "PATCH" : "POST",
          body,
          idempotencyKey: key.current,
        },
      );
      setAction(null);
      if (action === "run") onCreated(String(r.task_id));
      else await refresh();
    } catch (e) {
      fail(e);
      if (isVersionConflict(e) && selected) {
        try {
          const fresh = (await apiFetch<{ items: Row[] }>("/v1/job-templates")).items;
          setRows(fresh);
          const current = fresh.find(row => row.id === selected.id);
          if (current) setSelected(current);
          setError(current ? VERSION_CONFLICT_MESSAGE : "Шаблон больше недоступен. Вернитесь к списку.");
        } catch (refreshError) { fail(refreshError); }
      }
    } finally {
      setBusy(false);
    }
  }
  const query = search.trim().toLocaleLowerCase("ru");
  const fromTime = from ? Date.parse(`${from}T00:00:00+05:00`) : null;
  const toTime = to ? Date.parse(`${to}T23:59:59.999+05:00`) : null;
  const invalidPeriod = !!(from && to && from > to);
  const filteredRows = rows.filter(row => {
    const created = Date.parse(String(row.created_at ?? ""));
    return !invalidPeriod && (!query || [row.name, (row.blueprint as Row | undefined)?.title, (row.blueprint as Row | undefined)?.instruction]
      .some(value => String(value ?? "").toLocaleLowerCase("ru").includes(query))) &&
      (!stateFilter || row.active === (stateFilter === "active")) &&
      (fromTime === null || created >= fromTime) && (toTime === null || created <= toTime);
  });
  return (
    <PageLayout title="Шаблоны заданий"
      filters={<Space wrap>
        <Input.Search aria-label="Поиск шаблонов заданий" placeholder="Название или описание"
          value={search} onChange={event => setSearch(event.target.value)} style={{ width: 280, maxWidth: "100%" }} />
        <Select aria-label="Состояние шаблона" placeholder="Все состояния" allowClear
          value={stateFilter} onChange={setStateFilter} style={{ width: 230 }}
          options={[{ value: "active", label: "Действующие" }, { value: "inactive", label: "Неактивные" }]} />
        <Space wrap>
          <Typography.Text type="secondary">Дата создания:</Typography.Text>
          <Input aria-label="Дата создания с" title="Дата создания с (Алматы)" type="date"
            value={from} onChange={event => setFrom(event.target.value)} style={{ width: 155 }} />
          <Input aria-label="Дата создания по" title="Дата создания по (Алматы)" type="date"
            value={to} onChange={event => setTo(event.target.value)} style={{ width: 155 }} />
        </Space>
      </Space>}
      actions={<><Button type="primary" disabled={busy} onClick={() => begin("create", null)}>Создать шаблон</Button></>}>
      {invalidPeriod && <Alert type="warning" showIcon message="Дата начала периода позже даты окончания" />}
      {error && !action && <Alert type="error" message={error} />}

      <Collapse
        ghost
        items={[{
          key: "presets",
          label: `Готовые шаблоны для ОСИ (${OSI_PRESETS.length})`,
          children: (
            <List
              size="small"
              dataSource={OSI_PRESETS}
              renderItem={(p) => (
                <List.Item
                  actions={[
                    <Button
                      key="use"
                      disabled={busy}
                      onClick={() => beginPreset(p)}
                    >
                      Взять за основу
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={`${p.name} · ${p.periodicity}`}
                    description={p.instruction}
                  />
                </List.Item>
              )}
            />
          ),
        }]}
      />
      <ConfigurableTable storageKey="columns.job-templates" settingsPlacement="page"
        rowKey="id"
        loading={busy}
        dataSource={filteredRows}
        scroll={{ x: 600 }}
        columns={[{ title: "Шаблон", dataIndex: "name" }, {
          title: "Версия",
          dataIndex: "version",
        }, {
          title: "Действия",
          render: (_, r) => (
            <Space wrap>
              <Button onClick={() => { setScheduleDirty(false); setSchedule(r); }}>Расписание и запуски</Button>
              <Button onClick={() => begin("edit", r)}>Новая версия</Button>
              <Button onClick={() => void history(r)}>История версий</Button>
              <Button disabled={!r.active} onClick={() => begin("run", r)}>
                Создать задание
              </Button>
            </Space>
          ),
        }]}
      />
      {!!versions.length && (
        <>
          <Typography.Title level={4}>
            {String(selected?.name)} — версии методички
          </Typography.Title>
          <List
            dataSource={versions}
            renderItem={(v) => (
              <List.Item>
                <div>
                  Версия {String(v.version)},{" "}
                  {new Date(String(v.created_at)).toLocaleString()},{" "}
                  {String(v.author_name ?? "")}
                  <p>{String((v.blueprint as Row).instruction)}</p>
                </div>
              </List.Item>
            )}
          />
        </>
      )}
      <CardDrawer open={!!action || !!schedule} title={String(schedule?.name ?? selected?.name ?? "Шаблоны заданий")}
        closeDisabled={busy || scheduleBusy} onClose={() => { setAction(null); setSchedule(null); }}>
        <ActionPanel open={!!schedule} full title="Регулярные задания" busy={scheduleBusy}
          hasUnsavedChanges={() => scheduleDirty} onCancel={() => setSchedule(null)}>
          {schedule && <JobSchedule id={String(schedule.id)} onBusyChange={setScheduleBusy}
            onDirtyChange={setScheduleDirty} onCreated={id => { setSchedule(null); onCreated(id); }} />}
        </ActionPanel>

      <ActionPanel
        title={action === "run" ? "Ручной запуск задания" : "Версия шаблона"}
        open={!!action}
        full
        form={form}
        busy={busy}
        error={error}
        onCancel={() => !busy && setAction(null)}
      >
        <ProcessOverview guidance={{
          title: action === "run" ? "Нужно проверить условия запуска задания" : "Нужно подготовить методичку задания",
          description: action === "run" ? "Укажите срок выполнения. Запуск создаст отдельную общую работу и задание по выбранному шаблону; предыдущие задания сохранятся." : "Проверьте объём, инструкцию, требования к доказательствам и область. Сохранение создаёт версию шаблона; начатые задания сами не меняются.",
          waitingFor: PROCESS_MANAGER_ROLES,
        }} />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ active: true }}
          disabled={busy}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
          onFinish={(v) => void save(v)}
        >
          {action === "run"
            ? (
              <>
              <Form.Item
                name="due_at"
                label="Срок задания (местное время)"
                rules={required}
              >
                <DeadlineInput />
              </Form.Item>
              <Form.Item name="assignee_person_id" label="Исполнитель задания"><Select allowClear showSearch optionFilterProp="label" options={people.map(p => ({ value: p.id, label: String(p.full_name) }))} /></Form.Item>
              <Typography.Paragraph>Документальные требования применяются из выбранной версии методички. При отсутствии полномочий подготовителя или настроенного срока задание не создаётся.</Typography.Paragraph>
              </>
            )
            : (
              <>
                <Form.Item
                  name="name"
                  label="Название шаблона"
                  rules={required}
                >
                  <Input />
                </Form.Item>
                <Form.Item name="title" label="Объём задания" rules={required}>
                  <Input />
                </Form.Item>
                <Form.Item
                  name="instruction"
                  label="Утверждённая инструкция"
                  rules={required}
                >
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item name="buildings" label="Дома" rules={required}>
                  <Select
                    mode="multiple"
                    options={buildings.map((b) => ({
                      value: b.id,
                      label: String(b.name ?? b.code),
                    }))}
                  />
                </Form.Item>
                <Form.List name="required_evidence">
                  {(fields, { add, remove }) => (
                    <>
                      <Typography.Text>Чек-лист доказательств</Typography.Text>
                      {fields.map((f) => (
                        <div key={f.key}>
                          <Form.Item
                            name={[f.name, "id"]}
                            label="Пункт"
                            rules={required}
                          >
                            <Input />
                          </Form.Item>
                          <Form.Item name={[f.name, "kind"]} label="Вид">
                            <Select
                              options={[{ value: "file", label: "Файл" }, {
                                value: "photo",
                                label: "Фото",
                              }]}
                            />
                          </Form.Item>
                          <Form.Item
                            name={[f.name, "required"]}
                            valuePropName="checked"
                          >
                            <Checkbox>Обязательно</Checkbox>
                          </Form.Item>
                          <Button onClick={() => remove(f.name)}>
                            Убрать пункт
                          </Button>
                        </div>
                      ))}
                      <Button
                        onClick={() => add({ required: true, kind: "photo" })}
                      >
                        Добавить пункт
                      </Button>
                    </>
                  )}
                </Form.List>
                <DocumentRuleFields people={people} />
                <Form.Item name="active" valuePropName="checked">
                  <Checkbox>Доступен для новых заданий</Checkbox>
                </Form.Item>
                {action === "edit" && (
                  <Form.Item
                    name="reason"
                    label="Причина новой версии"
                    rules={required}
                  >
                    <Input.TextArea />
                  </Form.Item>
                )}
              </>
            )}
          <Button style={{ position: "sticky", bottom: 0, zIndex: 1, marginBlock: token.marginSM }} type="primary" htmlType="submit" loading={busy}>
            Сохранить
          </Button>
        </Form>
      </ActionPanel>
      </CardDrawer>
    </PageLayout>
  );
}
