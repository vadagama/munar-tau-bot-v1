import { DeadlineDatePicker } from "../components/deadline-input";
import { ProcessOverview, ProcessActions, ProcessHistory } from "../components/process-card";
import { incidentGuidance, processActionHint } from "../components/process-guidance";
import { DetailSection } from "../components/detail-section";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  List,
  Select,
  Space,
  Tabs,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { BoardView, ViewToggle, useBoardView } from "./board";
import { CardDrawer } from "./card-drawer";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
// Состояния инцидента — колонки доски (VS-7, docs/request-lifecycle.md §6).
const INCIDENT_STATES: Record<string, string> = {
  signal_check: "Проверка сигнала",
  confirmed: "Подтверждена",
  not_confirmed: "Не подтверждена",
  mitigation: "Устранение",
  recovery_check: "Проверка восстановления",
  completed: "Завершена",
};
const BOARD_COLUMNS = Object.entries(INCIDENT_STATES).map(([value, label]) => ({
  value,
  label,
}));
const names: Record<string, string> = {
  ...INCIDENT_STATES,
  assign: "Назначить ответственного",
  confirm: "Подтвердить",
  mark_unconfirmed: "Не подтверждена",
  recheck: "Повторная проверка",
  start_mitigation: "Начать устранение",
  report_recovery: "Сообщить о восстановлении",
  fail_check: "Проверка неуспешна",
  complete: "Завершить",
  reopen: "Возобновить",
  update: "Опубликовать обновление",
  warning: "Предупреждение о проверке",
};
export function IncidentsPage() {
  const [activeTab, setActiveTab] = useState("incidents");
  const { roles } = useCabinetIdentity(),
    [view, setView] = useBoardView("view.incidents"),
    manager = roles.some((r) =>
      ["chairman", "administrator", "deputy"].includes(r)
    );
  const [rows, setRows] = useState<Row[]>([]),
    [card, setCard] = useState<Row | null>(null),
    [signals, setSignals] = useState<Row[]>([]),
    [shifts, setShifts] = useState<Row[]>([]),
    [buildings, setBuildings] = useState<Row[]>([]),
    [people, setPeople] = useState<Row[]>([]),
    [premises, setPremises] = useState<Row[]>([]),
    [targets, setTargets] = useState<Row[]>([]),
    [distribution, setDistribution] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [form] = Form.useForm();
  const editScope = Form.useWatch("edit_scope", form);
  const selectedKind = Form.useWatch("kind", form);
  const scopeValues = Form.useWatch("scope", form) as Row[] | undefined;
  const key = useRef(crypto.randomUUID()), generation = useRef(0);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function refresh() {
    const g = ++generation.current;
    setBusy(true);
    try {
      const [r, s] = await Promise.all([
        apiFetch<{ items: Row[] }>("/v1/incidents"),
        apiFetch<{ items: Row[] }>("/v1/emergency-signals"),
      ]);
      if (g === generation.current) {
        setRows(r.items);
        setSignals(s.items);
      }
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  usePageRefresh(refresh, !busy);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, []);
  async function open(id: string) {
    setBusy(true);
    try {
      setCard(await apiFetch<Row>(`/v1/incidents/${id}`));
      setError(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function begin(next: string) {
    setError(null);
    setBusy(true);
    setAction(next);
    key.current = crypto.randomUUID();
    form.resetFields();
    form.setFieldsValue({
      forecast: card?.forecast ?? "Уточняется",
      first_signal_at: dayjs(),
      scope: next === "create" ? [{}] : card?.scope,
      restrictions: card?.restrictions,
    });
    try {
      if (["create", "shift", "assign", "update"].includes(next)) {
        try {
          const context = await apiFetch<
            { persons: Row[]; buildings: Row[]; premises: Row[] }
          >("/v1/incidents/context");
          setBuildings(context.buildings ?? []);
          setPeople(context.persons);
          setPremises(context.premises ?? []);
        } catch (e) {
          fail(e);
        }
      }
      if (next === "link") {
        try {
          const [r, w] = await Promise.all([
            apiFetch<{ items: Row[] }>("/v1/requests"),
            apiFetch<{ items: Row[] }>("/v1/common-works"),
          ]);
          setTargets([
            ...r.items.map((v) => ({ ...v, kind: "request" })),
            ...w.items.map((v) => ({ ...v, kind: "common_work" })),
          ]);
        } catch (e) {
          fail(e);
        }
      }
    } finally { setBusy(false); }
  }
  async function submit() {
    try {
      const values = await form.validateFields();
      for (
        const name of [
          "first_signal_at",
          "starts_at",
          "ends_at",
          "next_update_at",
          "started_at",
          "recovery_at",
        ]
      ) if (values[name]) values[name] = values[name].toISOString();
      setBusy(true);
      setError(null);
      let path = "/v1/incidents", body: Row = { ...values };
      if (action === "create") {
        body.scope = values.scope;
      } else if (action === "shift") path = "/v1/duty-shifts";
      else if (action === "assign") {
        path = `/v1/emergency-signals/${card!.id}/assign`;
        body.expected_version = card!.version;
      } else {
        path = `/v1/incidents/${card!.id}/${
          action === "link"
            ? "links"
            : action === "distribute"
            ? "distribute"
            : "transitions"
        }`;
        body = { ...values, action, expected_version: card!.version };
        if (!values.edit_scope) delete body.scope;
        if (action === "complete") body.danger_remains = !values.no_danger;
      }
      const result = await apiFetch<Row>(path, {
        method: "POST",
        body,
        idempotencyKey: key.current,
      });
      if (action === "distribute") {
        setDistribution((result.items as Row[]) ?? []);
      }
      await refresh();
      if (!["shift", "assign"].includes(action ?? "")) {
        await open(String(result.id ?? card?.id));
      }
      setAction(null);
    } catch (e) {
      if (e instanceof Error) fail(e);
      if (isVersionConflict(e) && card) {
        try {
          setCard(await apiFetch<Row>(`/v1/incidents/${card.id}`));
          setError(VERSION_CONFLICT_MESSAGE);
        } catch (refreshError) { fail(refreshError); }
      }
    } finally {
      setBusy(false);
    }
  }
  const scope = (card?.scope as Row[] | undefined) ?? [];
  const buildingOptions = buildings.map((b) => ({
      value: String(b.id),
      label: String(b.code ?? b.id),
    })
    ),
    personOptions = people.map((p) => ({
      value: String(p.id),
      label: String(p.full_name ?? p.id),
    }));
  return (
    <PageLayout title="Аварии и дежурство"
      extra={activeTab === "incidents" ? <ViewToggle kind={view} onChange={setView} /> : null}
      actions={manager ? (<><Button type="primary" onClick={() => void begin("create")}>Зарегистрировать сигнал</Button>{activeTab === "duty" && (<Space>
                    <Button onClick={() => void begin("shift")}>
                      Добавить смену
                    </Button>
                    <Button
                      onClick={() =>
                        void apiFetch<{ items: Row[] }>("/v1/duty-shifts").then(
                          (r) => setShifts(r.items),
                        ).catch(fail)}
                    >
                      Показать смены
                    </Button>
                  </Space>)}</>) : null}>

      {error && !card && !action && (
        <Alert
          type="error"
          showIcon
          message={error}
        />
      )}
      <Alert
        type="info"
        showIcon
        message="Сигнал не означает подтверждения выезда. Частичное восстановление не завершает общую аварию."
      />
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "incidents",
            label: "Инциденты",
            children: (
              <>

                {view === "board" ? (
                  <BoardView
                    columns={BOARD_COLUMNS}
                    rows={rows}
                    stateOf={(r) => String(r.state)}
                    onOpen={(r) => void open(String(r.id))}
                    selectedId={
                      card && typeof card.number === "string"
                        ? String(card.id)
                        : null
                    }
                    loading={busy}
                    emptyText="Доступных инцидентов нет"
                    renderCard={(r) => (
                      <>
                        <Typography.Text strong>
                          {String(r.number)}
                        </Typography.Text>
                        <Typography.Paragraph
                          ellipsis={{ rows: 2 }}
                          style={{ margin: 0 }}
                        >
                          {String(r.title)}
                        </Typography.Paragraph>
                      </>
                    )}
                  />
                ) : (
                  <ConfigurableTable storageKey="columns.incidents" settingsPlacement={activeTab === "incidents" ? "page" : "inline"}
                    rowKey="id"
                    dataSource={rows}
                    loading={busy}
                    scroll={{ x: 650 }}
                    locale={{ emptyText: "Доступных инцидентов нет" }}
                    columns={[{ title: "Номер", dataIndex: "number" }, {
                      title: "Проблема",
                      dataIndex: "title",
                    }, {
                      title: "Состояние",
                      dataIndex: "state",
                      render: (s) => names[String(s)] ?? s,
                    }, {
                      title: "",
                      render: (_, r) => (
                        <Button onClick={() => void open(String(r.id))}>
                          Открыть
                        </Button>
                      ),
                    }]}
                  />
                )}
              </>
            ),
          },
          {
            key: "signals",
            label: "Срочные сигналы",
            children: (
              <ConfigurableTable storageKey="columns.emergency-signals" settingsPlacement={activeTab === "signals" ? "page" : "inline"}
                rowKey="id"
                dataSource={signals}
                scroll={{ x: 650 }}
                columns={[{ title: "Описание", dataIndex: "description" }, {
                  title: "Принятие",
                  dataIndex: "accepted_at",
                  render: (_, r) => (
                    <Space>
                      {manager && (
                        <Button
                          onClick={() => {
                            setCard(r);
                            void begin("assign");
                          }}
                        >
                          Назначить ответственного
                        </Button>
                      )}
                      {r.accepted_at ? "Принято" : (
                        <Button
                          loading={busy}
                          onClick={() => {
                            setBusy(true);
                            void apiFetch(
                              `/v1/emergency-signals/${r.id}/accept`,
                              {
                                method: "POST",
                                body: { expected_version: r.version },
                                idempotencyKey: crypto.randomUUID(),
                              },
                            ).then(refresh).catch(fail).finally(() =>
                              setBusy(false)
                            );
                          }}
                        >
                          Принять ответственность
                        </Button>
                      )}
                    </Space>
                  ),
                }]}
              />
            ),
          },
          ...(manager
            ? [{
              key: "duty",
              label: "Дежурство",
              children: (
                <>

                  <ConfigurableTable storageKey="columns.duty-shifts" settingsPlacement={activeTab === "duty" ? "page" : "inline"}
                    rowKey="id"
                    dataSource={shifts}
                    scroll={{ x: 650 }}
                    columns={[{ title: "Начало", dataIndex: "starts_at" }, {
                      title: "Окончание",
                      dataIndex: "ends_at",
                    }, {
                      title: "Аварийный телефон",
                      dataIndex: "emergency_phone",
                    }]}
                  />
                </>
              ),
            }]
            : []),
        ]}
      />
      <CardDrawer
        open={!!action || (!!card && typeof card.number === "string")}
        title={card && typeof card.number === "string"
          ? `${card.number}: ${card.title}`
          : action === "create" ? "Новый инцидент" : action === "shift" ? "Смена дежурства" : "Срочный сигнал"}
        closeDisabled={busy}
        onClose={() => setCard(null)}
      >
        {error && card && !action && <Alert role="alert" type="error" showIcon message={error} />}
        {card && typeof card.number === "string" && (
          <div key={String(card.id)} className="process-card-content">
          <ProcessOverview guidance={incidentGuidance(card)} state={INCIDENT_STATES[String(card.state)]} due={card.next_update_at} dueLabel="Следующее обновление до">
          <ProcessActions primary={incidentGuidance(card).primary} secondary={["mark_unconfirmed", "fail_check", "update"]}>
            {((card.actions as string[] | undefined) ?? []).map((a) => (
              <Button
                key={a}
                onClick={() => void begin(a)}
              >
                {names[a]}
              </Button>
            ))}
            {(card.actions as string[] | undefined)?.length
              ? <Button key="update" onClick={() => void begin("update")}>Обновление</Button>
              : null}
            {manager && (
              <>
                <Button key="link" onClick={() => void begin("link")}>
                  Связать обращение / работу
                </Button>
                {card.state === "completed" && (
                  <Button key="distribute" onClick={() => void begin("distribute")}>
                    Передать итог обращениям
                  </Button>
                )}
              </>
            )}
          </ProcessActions>
          </ProcessOverview>
          <DetailSection title="Сведения об аварии">
          <Typography.Paragraph>
            {String(
              card.public_text ?? "Публичное обновление пока не опубликовано",
            )}
          </Typography.Paragraph>
          <Typography.Paragraph>
            Прогноз: {String(card.forecast ?? "Уточняется")}
          </Typography.Paragraph>
          <List
            dataSource={scope}
            renderItem={(s) => (
              <List.Item>
                {String(s.zone || s.building_id)} — {String(s.service)};{" "}
                {s.recovered_at
                  ? "восстановлено"
                  : "восстановление не подтверждено"}
              </List.Item>
            )}
          />
          </DetailSection>
          {distribution.length > 0 && (
            <List
              header="Передача результата обращениям"
              dataSource={distribution}
              renderItem={(r) => (
                <List.Item>
                  {String(r.id)}: {String(r.reason ?? r.state)}
                </List.Item>
              )}
            />
          )}
          <ProcessHistory>
          <List
            dataSource={(card.history as Row[]) ?? []}
            renderItem={(h) => (
              <List.Item>{String(h.at)} — {String(h.reason)}</List.Item>
            )}
          />
          </ProcessHistory>
          </div>
        )}
      <ActionPanel
        description={processActionHint("incident", action)}
        form={form}
        full
        error={error}
        open={action !== null}
        title={action === "create"
          ? "Новый инцидент"
          : action === "shift"
          ? "Смена дежурства"
          : action === "link"
          ? "Связь с инцидентом"
          : action === "distribute"
          ? "Передать итог обращениям"
          : names[action ?? ""]}
        onCancel={() => setAction(null)}
        onOk={() => void submit()}
        busy={busy}
      >
        <Form form={form} layout="vertical" disabled={busy}>
          {action === "update" && (
            <Form.Item name="edit_scope" valuePropName="checked">
              <Checkbox>Изменить охват аварии</Checkbox>
            </Form.Item>
          )}
          {(action === "create" || (action === "update" && editScope)) && (
            <Form.List name="scope">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`Зона ${field.name + 1}`}
                    >
                      <Form.Item
                        name={[field.name, "building_id"]}
                        label="Дом / объект"
                        rules={required}
                      >
                        <Select options={buildingOptions} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "service"]}
                        label="Затронутая услуга"
                        rules={required}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "zone"]}
                        label="Название зоны (для части объекта)"
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "premises_ids"]}
                        label="Помещения зоны (пусто — весь объект)"
                      >
                        <Select
                          mode="multiple"
                          options={premises.filter((p) =>
                            p.building_id ===
                              scopeValues?.[field.name]?.building_id
                          ).map((p) => ({
                            value: String(p.id),
                            label: `${p.kind}: ${p.number}`,
                          }))}
                        />
                      </Form.Item>
                      <Button
                        onClick={() => remove(field.name)}
                        disabled={fields.length === 1}
                      >
                        Убрать зону
                      </Button>
                    </Card>
                  ))}
                  <Button onClick={() => add({})}>
                    Добавить зону / услугу
                  </Button>
                </>
              )}
            </Form.List>
          )}
          {action === "create" && (
            <>
              <Form.Item name="title" label="Проблема" rules={required}>
                <Input />
              </Form.Item>
              <Form.Item name="place" label="Место" rules={required}>
                <Input />
              </Form.Item>
              <Form.Item name="service" label="Услуга" rules={required}>
                <Input />
              </Form.Item>
              <Form.Item
                name="responsible_person_id"
                label="Ответственный"
                rules={required}
              >
                <Select
                  options={personOptions}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item
                name="first_signal_at"
                label="Первый сигнал"
                rules={required}
              >
                <DatePicker showTime format="DD.MM.YYYY HH:mm" />
              </Form.Item>
            </>
          )}
          {action === "assign"
            ? (
              <>
                <Form.Item
                  name="responsible_person_id"
                  label="Новый ответственный"
                  rules={required}
                >
                  <Select options={personOptions} />
                </Form.Item>
                <Form.Item name="reason" label="Причина" rules={required}>
                  <Input.TextArea />
                </Form.Item>
              </>
            )
            : action === "shift"
            ? (
              <>
                <Form.Item name="building_id" label="Объект" rules={required}>
                  <Select options={buildingOptions} />
                </Form.Item>
                {[["primary_person_id", "Основной дежурный"], [
                  "reserve_person_id",
                  "Резервный дежурный",
                ], ["admin_person_id", "Администратор"]].map((
                  [name, label],
                ) => (
                  <Form.Item
                    key={name}
                    name={name}
                    label={label}
                    rules={required}
                  >
                    <Select options={personOptions} />
                  </Form.Item>
                ))}
                {[["starts_at", "Начало"], ["ends_at", "Окончание"], [
                  "emergency_phone",
                  "Аварийный телефон",
                ]].map(([name, label]) => (
                  <Form.Item
                    key={name}
                    name={name}
                    label={label}
                    rules={required}
                  >
                    {name?.endsWith("at")
                      ? <DatePicker showTime format="DD.MM.YYYY HH:mm" />
                      : <Input />}
                  </Form.Item>
                ))}
              </>
            )
            : action === "distribute"
            ? (
              <Alert
                type="info"
                message="Готовые обращения будут переданы своим авторам на подтверждение. Неготовые сохранят состояние и причину."
              />
            )
            : (
              <>
                <Form.Item
                  name="reason"
                  label={action === "create"
                    ? "Источник и основание сигнала"
                    : "Основание"}
                  rules={required}
                >
                  <Input.TextArea rows={2} />
                </Form.Item>
                {action === "link"
                  ? (
                    <>
                      <Form.Item name="kind" label="Тип" rules={required}>
                        <Select
                          options={[{ value: "request", label: "Обращение" }, {
                            value: "common_work",
                            label: "Общая работа",
                          }]}
                        />
                      </Form.Item>
                      <Form.Item
                        name="target_id"
                        label="Обращение или работа"
                        rules={required}
                      >
                        <Select
                          options={targets.filter((t) =>
                            t.kind === selectedKind
                          ).map((t) => ({
                            value: String(t.id),
                            label: `${t.number}: ${t.title ?? t.text ?? ""}`,
                          }))}
                        />
                      </Form.Item>
                      <Form.Item name="unlink" valuePropName="checked">
                        <Checkbox>Отсоединить связь</Checkbox>
                      </Form.Item>
                      <Form.Item
                        name="next_route"
                        label="Дальнейший маршрут при отсоединении"
                      >
                        <Input.TextArea />
                      </Form.Item>
                      <Form.Item name="place_verified" valuePropName="checked">
                        <Checkbox>Место проверено</Checkbox>
                      </Form.Item>
                      <Form.Item name="cause_verified" valuePropName="checked">
                        <Checkbox>Причина проверена</Checkbox>
                      </Form.Item>
                    </>
                  )
                  : action !== "create" && (
                    <>
                      <Form.Item
                        name="public_text"
                        label="Сообщение жителям без персональных данных"
                        rules={required}
                      >
                        <Input.TextArea rows={4} />
                      </Form.Item>
                      <Form.Item
                        name="restrictions"
                        label="Оставшиеся ограничения"
                      >
                        <Input.TextArea />
                      </Form.Item>
                      <Form.Item
                        name="forecast"
                        label="Прогноз"
                        rules={required}
                      >
                        <Input />
                      </Form.Item>
                      {!["complete", "mark_unconfirmed"].includes(
                        action ?? "",
                      ) && (
                        <Form.Item
                          name="next_update_at"
                          label="Следующее обновление"
                          rules={required}
                        >
                          <DeadlineDatePicker showTime format="DD.MM.YYYY HH:mm" />
                        </Form.Item>
                      )}
                      {action === "start_mitigation" && (
                        <>
                          <Form.Item
                            name="executor"
                            label="Исполнитель / внешняя служба"
                            rules={required}
                          >
                            <Input />
                          </Form.Item>
                          <Form.Item
                            name="started_at"
                            label="Фактическое начало"
                            rules={required}
                          >
                            <DatePicker showTime format="DD.MM.YYYY HH:mm" />
                          </Form.Item>
                        </>
                      )}
                      {["report_recovery", "complete"].includes(action ?? "") &&
                        (
                          <>
                            <Form.Item
                              name="check_method"
                              label="Способ проверки"
                              rules={required}
                            >
                              <Input />
                            </Form.Item>
                            <Form.Item
                              name={action === "complete"
                                ? "final_report"
                                : "recovery_report"}
                              label="Отчёт"
                              rules={required}
                            >
                              <Input.TextArea />
                            </Form.Item>
                          </>
                        )}
                      {["complete", "report_recovery"].includes(action ?? "") &&
                        (
                          <>
                            <Form.Item
                              name="recovered_scope_ids"
                              label="Проверенные зоны"
                              rules={required}
                            >
                              <Select
                                mode="multiple"
                                options={scope.map((s) => ({
                                  value: String(s.id),
                                  label: `${
                                    s.zone || s.building_id
                                  }: ${s.service}`,
                                }))}
                              />
                            </Form.Item>
                            <Form.Item
                              name="recovery_at"
                              label="Фактическое восстановление"
                              rules={required}
                            >
                              <DatePicker showTime format="DD.MM.YYYY HH:mm" />
                            </Form.Item>
                            {action === "complete" && (
                              <Form.Item
                                name="no_danger"
                                valuePropName="checked"
                              >
                                <Checkbox>
                                  Проверено: опасности нет во всём охвате
                                </Checkbox>
                              </Form.Item>
                            )}
                          </>
                        )}
                    </>
                  )}
              </>
            )}
        </Form>
      </ActionPanel>
      </CardDrawer>

    </PageLayout>
  );
}
