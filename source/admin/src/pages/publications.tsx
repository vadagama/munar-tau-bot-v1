import { DeadlineDatePicker } from "../components/deadline-input";
import { ProcessOverview, ProcessActions, ProcessHistory } from "../components/process-card";
import { publicationGuidance, processActionHint } from "../components/process-guidance";
import { DetailSection } from "../components/detail-section";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  List,
  Select,
  Space,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { CardDrawer } from "./card-drawer";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
const kinds: Record<string, string> = {
  announcement: "Объявление",
  outage: "Плановое отключение",
  work_report: "Отчёт о работе",
  financial_report: "Финансовый отчёт",
};
const actionNames: Record<string, string> = {
  create: "Новая публикация", edit: "Редактирование публикации",
  media: "Выбрать фото и видео", problem: "Сообщить о проблеме",
  submit_approval: "На согласование председателю", publish: "Опубликовать",
  schedule: "Запланировать публикацию", approve: "Разрешить публикацию",
  update_outage: "Обновить план отключения", restore: "Подтвердить восстановление",
  archive: "В архив",
};
const states: Record<string, string> = {
  draft: "Черновик",
  pending_approval: "На согласовании",
  scheduled: "Запланирована",
  published: "Опубликована",
  archived: "В архиве",
};
export function PublicationsPage() {
  const { roles } = useCabinetIdentity(),
    manager = roles.some((r) =>
      ["chairman", "administrator", "deputy"].includes(r)
    );
  const [rows, setRows] = useState<Row[]>([]),
    [card, setCard] = useState<Row | null>(null),
    [buildings, setBuildings] = useState<Row[]>([]),
    [works, setWorks] = useState<Row[]>([]),
    [people, setPeople] = useState<Row[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [form] = Form.useForm();
  const kind = Form.useWatch("kind", form),
    key = useRef(crypto.randomUUID()),
    generation = useRef(0);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function refresh() {
    const g = ++generation.current;
    setBusy(true);
    try {
      const r = await apiFetch<{ items: Row[] }>("/v1/publications");
      if (g === generation.current) setRows(r.items);
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
    try {
      setCard(await apiFetch<Row>(`/v1/publications/${id}`));
      setError(null);
    } catch (e) {
      fail(e);
    }
  }
  async function begin(a: string) {
    setError(null);
    setBusy(true);
    setAction(a);
    key.current = crypto.randomUUID();
    form.resetFields();
    form.setFieldsValue({ kind: "announcement", requires_document: false });
    try {
      if (a === "edit" && card) {
        form.setFieldsValue({
          ...card,
          planned_start: card.planned_start
            ? dayjs(String(card.planned_start))
            : undefined,
          planned_end: card.planned_end
            ? dayjs(String(card.planned_end))
            : undefined,
        });
      }
      if (a === "media") {
        form.setFieldsValue({
          attachment_ids: ((card?.files as Row[]) ?? []).map((f) => f.id),
        });
      }
      if (a === "create" || a === "edit") {
        try {
          const [b, w, p] = await Promise.all([
            apiFetch<{ items: Row[] }>("/v1/registry/buildings"),
            apiFetch<{ items: Row[] }>("/v1/common-works"),
            apiFetch<{ persons: Row[] }>("/v1/incidents/context"),
          ]);
          setBuildings(b.items);
          setWorks(w.items.filter((x) => x.state === "completed"));
          setPeople(p.persons);
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
          "planned_start",
          "planned_end",
          "publish_at",
          "restored_at",
        ]
      ) if (values[name]) values[name] = values[name].toISOString();
      setBusy(true);
      setError(null);
      const result = await apiFetch<Row>(
        action === "create"
          ? "/v1/publications"
          : action === "edit"
          ? `/v1/publications/${card!.id}`
          : `/v1/publications/${card!.id}/${
            action === "media"
              ? "media"
              : action === "problem"
              ? "problems"
              : "transitions"
          }`,
        {
          method: action === "edit" ? "PATCH" : "POST",
          body: action === "create"
            ? values
            : { ...values, action, expected_version: card!.version },
          idempotencyKey: key.current,
        },
      );
      await refresh();
      if (action !== "problem") await open(String(result.id));
      setAction(null);
    } catch (e) {
      if (e instanceof Error) fail(e);
      if (isVersionConflict(e) && card) {
        try {
          setCard(await apiFetch<Row>(`/v1/publications/${card.id}`));
          setError(VERSION_CONFLICT_MESSAGE);
        } catch (refreshError) { fail(refreshError); }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageLayout title="Публикации и отключения"
      actions={manager ? (<Space wrap>
        {manager && (
          <Button type="primary" onClick={() => void begin("create")}>
            Создать публикацию
          </Button>
        )}
      </Space>) : null}>

      {error && !card && !action && <Alert type="error" message={error} showIcon />}

      <ConfigurableTable storageKey="columns.publications" settingsPlacement="page"
        rowKey="id"
        dataSource={rows}
        loading={busy}
        scroll={{ x: 650 }}
        locale={{ emptyText: "Публикаций нет" }}
        columns={[{ title: "Название", dataIndex: "title" }, {
          title: "Вид",
          dataIndex: "kind",
          render: (k) => kinds[String(k)],
        }, {
          title: "Состояние",
          dataIndex: "state",
          render: (s) => states[String(s)],
        }, {
          title: "",
          render: (_, r) => (
            <Button onClick={() => void open(String(r.id))}>Открыть</Button>
          ),
        }]}
      />
      <CardDrawer
        open={!!card || !!action}
        title={card ? String(card.title) : "Новая публикация"}
        closeDisabled={busy}
        onClose={() => setCard(null)}
      >
        {error && card && !action && <Alert role="alert" type="error" showIcon message={error} />}
        {card && (
          <div key={String(card.id)} className="process-card-content">
          <ProcessOverview guidance={publicationGuidance(card, manager, roles.includes("chairman"))} state={states[String(card.state)]} due={card.publish_at} dueLabel="Публикация">
            <ProcessActions primary={publicationGuidance(card, manager, roles.includes("chairman")).primary}>
          {card.kind === "work_report" && card.state === "published" && (
            <Button key="problem" onClick={() => void begin("problem")}>
              Сообщить о проблеме с этой работой
            </Button>
          )}
          {manager && (
            <>
              {card.state === "draft" && (
                <>
                  <Button key="edit" onClick={() => void begin("edit")}>
                    Редактировать
                  </Button>
                  {card.kind === "work_report" && (
                    <Button key="media" onClick={() => void begin("media")}>
                      Выбрать фото и видео
                    </Button>
                  )}
                </>
              )}
              {card.state === "draft" && (
                <>
                  {card.kind === "financial_report" && !card.approved_by
                    ? (
                      <Button key="submit_approval" onClick={() => void begin("submit_approval")}>
                        На согласование председателю
                      </Button>
                    )
                    : (
                      <>
                        <Button key="publish"
                          type="primary"
                          onClick={() => void begin("publish")}
                        >
                          Опубликовать
                        </Button>
                        <Button key="schedule" onClick={() => void begin("schedule")}>
                          Запланировать
                        </Button>
                      </>
                    )}
                </>
              )}
              {card.state === "pending_approval" &&
                roles.includes("chairman") && (
                <Button key="approve" onClick={() => void begin("approve")}>
                  Разрешить публикацию
                </Button>
              )}
              {card.state === "published" && card.kind === "outage" &&
                !card.restored_at && (
                <>
                  <Button key="update_outage" onClick={() => void begin("update_outage")}>
                    Обновить план
                  </Button>
                  <Button key="restore"
                    onClick={() => void begin("restore")}
                  >
                    Подтвердить восстановление
                  </Button>
                </>
              )}
              {["published", "scheduled"].includes(String(card.state)) && (
                <Button key="archive" onClick={() => void begin("archive")}>В архив</Button>
              )}
            </>
          )}
            </ProcessActions>
          </ProcessOverview>
          <DetailSection title="Содержание публикации">
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
            {String(card.body)}
          </Typography.Paragraph>
          {card.kind === "outage" && (
            <Alert
              type="info"
              message={`План: ${card.planned_start} — ${card.planned_end}. Фактическое восстановление: ${
                card.restored_at ?? "не подтверждено"
              }`}
            />
          )}
          <List
            dataSource={(card.files as Row[]) ?? []}
            renderItem={(f) => (
              <List.Item>
                <Button
                  onClick={() => {
                    void apiFetch<{ url: string }>(
                      `/v1/publications/${card.id}/files/${f.id}/url`,
                    ).then((r) =>
                      window.open(r.url, "_blank", "noopener,noreferrer")
                    ).catch(fail);
                  }}
                >
                  {String(f.filename)}
                </Button>
              </List.Item>
            )}
          />
          </DetailSection>
          <ProcessHistory>
          <List
            dataSource={(card.history as Row[]) ?? []}
            renderItem={(h) => (
              <List.Item>{String(h.at)} — версия {String(h.version)}</List.Item>
            )}
          />
          </ProcessHistory>
          </div>
        )}
      <ActionPanel
        description={processActionHint("publication", action)}
        form={form}
        error={error}
        full={action === "create" || action === "edit"}
        open={!!action}
        title={actionNames[action ?? ""] ?? "Действие с публикацией"}
        okText={action === "edit" ? "Сохранить изменения" : action === "create" ? "Создать публикацию" : action === "media" ? "Сохранить материалы" : action === "problem" ? "Отправить сообщение" : actionNames[action ?? ""] ?? "Сохранить"}
        onCancel={() => setAction(null)}
        onOk={() => void submit()}
        busy={busy}
      >
        <Form form={form} layout="vertical" disabled={busy}>
          {["create", "edit"].includes(action ?? "") && (
            <>
              <Form.Item name="kind" label="Вид" rules={required}>
                <Select
                  options={Object.entries(kinds).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Form.Item>
              <Form.Item name="title" label="Название" rules={required}>
                <Input />
              </Form.Item>
              <Form.Item name="body" label="Текст для жителей" rules={required}>
                <Input.TextArea rows={5} />
              </Form.Item>
              <Form.Item name="building_ids" label="Аудитория" rules={required}>
                <Select
                  mode="multiple"
                  options={buildings.map((b) => ({
                    value: String(b.id),
                    label: String(b.code),
                  }))}
                />
              </Form.Item>
              <Form.Item name="requires_document" valuePropName="checked">
                <Checkbox>
                  Сообщение о взносах, правилах или решении — требуется
                  утверждённый документ
                </Checkbox>
              </Form.Item>
              <Alert
                type="info"
                message="Документальные основания подключаются в VS-8. Публикация с обязательным документом пока блокируется."
              />
              {kind === "work_report" && (
                <Form.Item
                  name="common_work_id"
                  label="Принятая общая работа"
                  rules={required}
                >
                  <Select
                    options={works.map((w) => ({
                      value: String(w.id),
                      label: `${w.number}: ${w.title}`,
                    }))}
                  />
                </Form.Item>
              )}
              {kind === "outage" && (
                <>
                  <Form.Item name="service" label="Услуга" rules={required}>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="responsible_person_id"
                    label="Ответственный"
                    rules={required}
                  >
                    <Select
                      options={people.map((p) => ({
                        value: String(p.id),
                        label: String(p.full_name),
                      }))}
                    />
                  </Form.Item>
                  {[["planned_start", "Начало"], ["planned_end", "Окончание"]]
                    .map(([name, label]) => (
                      <Form.Item
                        key={name}
                        name={name}
                        label={label}
                        rules={required}
                      >
                        {name === "planned_end"
                          ? <DeadlineDatePicker showTime format="DD.MM.YYYY HH:mm" />
                          : <DatePicker showTime format="DD.MM.YYYY HH:mm" />}
                      </Form.Item>
                    ))}
                </>
              )}
            </>
          )}
          {action === "media" && (
            <>
              <Form.Item
                name="attachment_ids"
                label="Выбранные материалы"
                rules={required}
              >
                <Select
                  mode="multiple"
                  options={((card?.available_files as Row[]) ?? []).map(
                    (f) => ({ value: String(f.id), label: String(f.filename) }),
                  )}
                />
              </Form.Item>
              <Form.Item name="privacy_checked" valuePropName="checked">
                <Checkbox>
                  Проверено: выбранные материалы можно раскрыть аудитории
                  публикации; чужих личных данных нет
                </Checkbox>
              </Form.Item>
            </>
          )}
          {action === "problem" && (
            <>
              <Form.Item name="building_id" label="Объект" rules={required}>
                <Select
                  options={((card?.building_ids as string[]) ?? []).map(
                    (value) => ({
                      value,
                      label: buildings.find((b) =>
                        b.id === value
                      )?.code as string ?? "Объект публикации",
                    }),
                  )}
                />
              </Form.Item>
              <Form.Item
                name="location_text"
                label="Где сохранилась проблема"
                rules={required}
              >
                <Input />
              </Form.Item>
              <Form.Item name="text" label="Описание" rules={required}>
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {action === "schedule" && (
            <Form.Item
              name="publish_at"
              label="Время публикации"
              rules={required}
            >
              <DatePicker showTime format="DD.MM.YYYY HH:mm" />
            </Form.Item>
          )}
          {action === "approve" && (
            <Form.Item
              name="approval_note"
              label="Основание внешних согласований"
              rules={required}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "archive" && (
            <Form.Item name="reason" label="Причина" rules={required}>
              <Input.TextArea />
            </Form.Item>
          )}
          {["restore", "update_outage"].includes(action ?? "") && (
            <>
              <Form.Item
                name="body"
                label="Обновление для жителей"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
              <Form.Item
                name={action === "restore" ? "restored_at" : "planned_end"}
                label={action === "restore"
                  ? "Фактическое восстановление"
                  : "Новый срок окончания"}
                rules={required}
              >
                {action === "restore"
                  ? <DatePicker showTime format="DD.MM.YYYY HH:mm" />
                  : <DeadlineDatePicker showTime format="DD.MM.YYYY HH:mm" />}
              </Form.Item>
              {action === "restore" && (
                <Form.Item
                  name="restoration_method"
                  label="Как проверено восстановление"
                  rules={required}
                >
                  <Input.TextArea />
                </Form.Item>
              )}
            </>
          )}
          {action === "publish" && (
            <Alert
              type="warning"
              showIcon
              message="Проверьте текст и аудиторию. Публикация будет доступна жителям и попадёт в их уведомления по настройкам."
            />
          )}
        </Form>
      </ActionPanel>
      </CardDrawer>

    </PageLayout>
  );
}
