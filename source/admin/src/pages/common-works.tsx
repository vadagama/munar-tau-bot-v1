import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import { CardDrawer } from "./card-drawer";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  List,
  Select,
  Space,
  Typography,
  theme,
} from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
const labels: Record<string, string> = {
  planned: "Запланирована",
  in_progress: "Выполняется",
  on_review: "На проверке",
  completed: "Завершена",
  canceled: "Отменена",
};
export function CommonWorks({ onTask }: { onTask: (id: string) => void }) {
  const { token } = theme.useToken();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]),
    [card, setCard] = useState<Row | null>(null),
    [buildings, setBuildings] = useState<Row[]>([]),
    [requests, setRequests] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<string | null>(null);
  const [form] = Form.useForm();
  const generation = useRef(0), key = useRef(crypto.randomUUID());
  const requestName = (id: string) =>
    String(
      ((card?.request_refs as Row[]) ?? []).find((r) => r.id === id)?.number ??
        "Обращение",
    );
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function refresh(preserveCard = false) {
    const g = ++generation.current;
    setBusy(true);
    try {
      const r = await apiFetch<{ items: Row[] }>("/v1/common-works");
      if (g === generation.current) {
        setRows(r.items);
        if (!preserveCard) setCard(null);
      }
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  usePageRefresh(() => refresh(true), !busy);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, []);
  async function open(id: unknown, preserveCard = false) {
    const g = ++generation.current;
    if (!preserveCard) setCard(null);
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<Row>(`/v1/common-works/${id}`);
      if (g === generation.current) setCard(r);
    } catch (e) {
      if (g === generation.current) { setCard(null); fail(e); }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function begin(value: string) {
    setError(null);
    form.resetFields();
    key.current = crypto.randomUUID();
    setBusy(true);
    try {
      if (value === "create") {
        setBuildings(
          (await apiFetch<{ items: Row[] }>("/v1/registry/buildings")).items,
        );
      }
      if (value === "link") {
        setRequests(
          (await apiFetch<{ items: Row[] }>("/v1/requests")).items.filter((r) =>
            r.can_manage && r.kind === "request" &&
            ![
              "closed",
              "canceled",
              "rejected",
              "draft",
              "awaiting_confirmation",
            ].includes(String(r.state))
          ),
        );
      }
      setAction(value);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function save(values: Row) {
    setBusy(true);
    setError(null);
    try {
      const body: Row = { ...values, version: card?.version };
      if (body.due_at) {
        body.due_at = new Date(String(body.due_at)).toISOString();
      }
      const suffix = action === "create"
        ? ""
        : action === "link" || action === "unlink"
        ? `/${card!.id}/requests`
        : `/${card!.id}/transitions`;
      if (action === "complete" || action === "cancel") body.action = action;
      const result = await apiFetch<Row>(`/v1/common-works${suffix}`, {
        method: action === "unlink" ? "DELETE" : "POST",
        body,
        idempotencyKey: key.current,
      });
      await refresh(true);
      await open(result.id, true);
      setAction(null);
    } catch (e) {
      fail(e);
      if (isVersionConflict(e) && card) {
        try { setCard(await apiFetch<Row>("/v1/common-works/" + card.id)); setError(VERSION_CONFLICT_MESSAGE); }
        catch (refreshError) { fail(refreshError); }
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
    return !invalidPeriod && (!query || [row.number, row.title, row.description, row.plan]
      .some(value => String(value ?? "").toLocaleLowerCase("ru").includes(query))) &&
      (!stateFilter || row.state === stateFilter) &&
      (fromTime === null || created >= fromTime) && (toTime === null || created <= toTime);
  });
  return (
    <PageLayout title="Общие работы"
      filters={<Space wrap>
        <Input.Search aria-label="Поиск общих работ" placeholder="Номер или описание"
          value={search} onChange={event => setSearch(event.target.value)} style={{ width: 280, maxWidth: "100%" }} />
        <Select aria-label="Состояние общей работы" placeholder="Все состояния" allowClear
          value={stateFilter} onChange={setStateFilter} style={{ width: 230 }}
          options={Object.entries(labels).map(([value, label]) => ({ value, label }))} />
        <Space wrap>
          <Typography.Text type="secondary">Дата создания:</Typography.Text>
          <Input aria-label="Дата создания с" title="Дата создания с (Алматы)" type="date"
            value={from} onChange={event => setFrom(event.target.value)} style={{ width: 155 }} />
          <Input aria-label="Дата создания по" title="Дата создания по (Алматы)" type="date"
            value={to} onChange={event => setTo(event.target.value)} style={{ width: 155 }} />
        </Space>
      </Space>}
      actions={<><Button type="primary" onClick={() => void begin("create")} disabled={busy}>Создать общую работу</Button></>}>
      {invalidPeriod && <Alert type="warning" showIcon message="Дата начала периода позже даты окончания" />}
      {error && !card && !action && <Alert type="error" message={error} />}

      <ConfigurableTable storageKey="columns.common-works" settingsPlacement="page"
        rowKey="id"
        dataSource={filteredRows}
        loading={busy}
        scroll={{ x: 500 }}
        columns={[
          {
            title: "Номер",
            render: (_, r) => (
              <Button
                type="link"
                onClick={() => void open(r.id)}
              >
                {String(r.number)}
              </Button>
            ),
          },
          { title: "Работа", dataIndex: "title" },
          { title: "Состояние", render: (_, r) => labels[String(r.state)] },
        ]}
      />
      <CardDrawer open={!!card || !!action} closeDisabled={busy} onClose={() => { generation.current++; setCard(null); }} title={card ? String(card.number) + " — " + String(card.title) : "Новая общая работа"}>
      {error && card && !action && <Alert type="error" message={error} />}
      {card && (
        <section aria-label={`${card.number} — ${card.title}`}>
          <p>{String(card.plan)}</p>
          <p>Срок: {new Date(String(card.due_at)).toLocaleString()}</p>
          <p>{labels[String(card.state)]}</p>
          {!["completed", "canceled"].includes(String(card.state)) && (
            <Space wrap>
              <Button
                onClick={() =>
                  onTask(String(card.id))}
              >
                Добавить задание
              </Button>
              <Button onClick={() => void begin("link")}>
                Связать обращение
              </Button>
              <Button onClick={() => void begin("complete")}>
                Завершить работу
              </Button>
              <Button danger onClick={() => void begin("cancel")}>
                Отменить работу
              </Button>
            </Space>
          )}
          <Typography.Title level={4}>Связанные обращения</Typography.Title>
          <List
            dataSource={(card.request_ids as string[]) ?? []}
            renderItem={(id) => (
              <List.Item>
                <span>{requestName(id)}</span>
                <Button
                  onClick={() => {
                    void begin("unlink");
                    form.setFieldValue("request_id", id);
                  }}
                >
                  Отвязать
                </Button>
              </List.Item>
            )}
          />
          <Typography.Title level={4}>Задания</Typography.Title>
          <List
            dataSource={(card.tasks as Row[]) ?? []}
            renderItem={(t) => (
              <List.Item>{String(t.number)} — {String(t.title)}</List.Item>
            )}
          />
          <Typography.Title level={4}>История</Typography.Title>
          <List
            dataSource={(card.log as Row[]) ?? []}
            renderItem={(l) => (
              <List.Item>
                {new Date(String(l.at)).toLocaleString()}:{" "}
                {labels[String(l.to_state)]}
                {(l.meta as Row)?.previous_completed_at
                  ? " (прежняя дата завершения сохранена)"
                  : ""}
              </List.Item>
            )}
          />
        </section>
      )}
      <ActionPanel
        open={!!action}
        full={action === "create" || action === "cancel"}
        busy={busy}
        error={error}
        form={form}
        title={action === "create"
          ? "Новая общая работа"
          : "Решение по общей работе"}
        onCancel={() => !busy && setAction(null)}
      >
        <Form
          form={form}
          layout="vertical"
          disabled={busy}
          onFinish={(v) => void save(v)}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
        >
          {action === "create" && (
            <>
              <Form.Item name="title" label="Работа" rules={required}>
                <Input />
              </Form.Item>
              <Form.Item name="plan" label="План для жителей" rules={required}>
                <Input.TextArea />
              </Form.Item>
              <Form.Item
                name="due_at"
                label="Срок (местное время)"
                rules={required}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="building_ids" label="Дома" rules={required}>
                <Select
                  mode="multiple"
                  options={buildings.map((b) => ({
                    value: b.id,
                    label: String(b.name ?? b.code),
                  }))}
                />
              </Form.Item>
            </>
          )}
          {action === "link" && (
            <Form.Item name="request_id" label="Обращение" rules={required}>
              <Select
                options={requests.map((r) => ({
                  value: r.id,
                  label: `${r.number} — ${r.description}`,
                }))}
              />
            </Form.Item>
          )}
          {action === "unlink" && (
            <>
              <Form.Item name="request_id" hidden>
                <Input />
              </Form.Item>
              <Form.Item
                name="resolution_plan"
                label="Дальнейший план для жителя"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {["complete", "cancel", "unlink"].includes(action ?? "") && (
            <Form.Item name="reason" label="Основание решения" rules={required}>
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "cancel" && (
            <Form.Item
              name="stop_checked"
              valuePropName="checked"
              rules={[{
                validator: (_, v) =>
                  v
                    ? Promise.resolve()
                    : Promise.reject(new Error("Подтвердите остановку")),
              }]}
            >
              <Checkbox>
                Остановка всех заданий и влияние на связанные обращения
                согласованы
              </Checkbox>
            </Form.Item>
          )}
          {action === "cancel" &&
            ((card?.request_ids as string[]) ?? []).map((id, i) => (
              <div key={id}>
                <Form.Item
                  name={["request_decisions", i, "request_id"]}
                  initialValue={id}
                  hidden
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name={["request_decisions", i, "reason"]}
                  label={`Решение по обращению ${requestName(id)}`}
                  rules={required}
                >
                  <Input.TextArea />
                </Form.Item>
              </div>
            ))}
          <Button style={{ position: "sticky", bottom: 0, zIndex: 1, marginBlock: token.marginSM }} htmlType="submit" type="primary" loading={busy}>
            Сохранить
          </Button>
        </Form>
      </ActionPanel>
      </CardDrawer>

    </PageLayout>
  );
}
