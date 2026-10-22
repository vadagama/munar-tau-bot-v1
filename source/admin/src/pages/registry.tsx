import { ProcessOverview } from "../components/process-card";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { ActionPanel } from "./action-panel";
import { CardDrawer } from "./card-drawer";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";

type Row = Record<string, unknown>;
type Entity = "buildings" | "premises" | "persons" | "connections";
const CONSTRUCTION_PHASES = [1, 2, 3, 4, 5].map(value => ({ value, label: `${value}-я очередь` }));
const KINDS = [
  { value: "apartment", label: "Квартира" },
  { value: "commercial", label: "Коммерческое помещение" },
  { value: "parking_slot", label: "Парковочное место" },
  { value: "storage", label: "Кладовка" },
];
const ROLES = [
  { value: "owner", label: "Собственник" },
  { value: "tenant", label: "Арендатор" },
  { value: "resident", label: "Проживающий" },
  { value: "other", label: "Уполномоченный пользователь" },
];
const LABELS: Record<string, string> = {
  buildings: "Здания",
  premises: "Помещения",
  persons: "Жители",
  connections: "Привязки помещений",
  full_name: "ФИО",
  phone_e164: "Телефон",
  code: "Обозначение",
  name: "Название",
  construction_phase: "Очередь строительства",
  kind: "Тип",
  number: "Номер",
  role: "Отношение",
  status: "Состояние",
  basis: "Основание",
  building_code: "Здание",
  comment: "Служебная заметка",
  entrance: "Подъезд / секция",
  floor: "Этаж",
  processing_basis: "Основание обработки данных",
  source: "Источник сведений",
};
export const displayKind = (value: unknown) =>
  KINDS.find((x) => x.value === value)?.label ?? String(value ?? "");
export const displayRole = (value: unknown) =>
  ROLES.find((x) => x.value === value)?.label ?? String(value ?? "");
const ROLE_LABELS: Record<string, string> = {
  chairman: "Председатель", administrator: "Администратор", deputy: "Заместитель",
  executor: "Исполнитель", tech_admin: "Технический администратор", duty: "Дежурный",
  finance: "Финансы", doc_reviewer: "Проверяющий документов",
};
const STATUS: Record<string, string> = {
  active: "Действует",
  pending: "Не подтверждена",
  revoked: "Прекращена",
  archived: "Архив",
};
const REGISTRATION_STATES: Record<string, string> = {
  approved: "Зарегистрирован", pending_review: "Ожидает проверки", need_clarification: "Нужны уточнения",
  rejected: "Отказано", disputed: "Спор", withdrawn: "Отозвана", none: "Нет анкеты",
};
const linkedPremises = (row: Row): Row[] => Array.isArray(row.linked_premises) ? row.linked_premises : [];
const residentAddress = (row: Row): string => [...new Set(linkedPremises(row).map(p =>
  p.building_name && p.building_name !== p.building_code
    ? `${p.building_name} (${p.building_code})` : String(p.building_code ?? "—"),
))].join(", ") || "Адрес не указан";
const residentPremises = (row: Row): string => linkedPremises(row).map(p =>
  `${p.building_code} · ${displayKind(p.kind)} ${p.number} · ${displayRole(p.role)}`,
).join("; ") || "Помещения не привязаны";
export function RegistryPage({ users }: { users?: "residents" | "staff" }) {
  const [entity, setEntity] = useState<Entity>(users ? "persons" : "premises"),
    [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [saving, setSaving] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null),
    [buildings, setBuildings] = useState<Row[]>([]),
    [premises, setPremises] = useState<Row[]>([]),
    [persons, setPersons] = useState<Row[]>([]);
  const [residentSearch, setResidentSearch] = useState("");
  const [registrationState, setRegistrationState] = useState<string>();
  const [residentBuilding, setResidentBuilding] = useState<string>();
  const [hasPremises, setHasPremises] = useState<string>();
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [constructionPhase, setConstructionPhase] = useState<number | "all" | "unassigned">("all");
  const [form] = Form.useForm();
  const [recovery, setRecovery] = useState<Row | null>(null),
    [pending, setPending] = useState<Row[]>([]);
  const [recoveryForm] = Form.useForm();
  const openRecovery = async (row: Row) => {
    try {
      setPending(
        (await apiFetch<{ items: Row[] }>("/v1/registrations")).items.filter(
          (r) =>
            ["pending_review", "need_clarification"].includes(String(r.state)),
        ),
      );
      setEditing(undefined);
      recoveryForm.resetFields();
      setRecovery(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };
  const recover = async () => {
    try {
      const values = await recoveryForm.validateFields();
      setSaving(true);
      await apiFetch(`/v1/registry/persons/${recovery!.id}/telegram-recovery`, {
        method: "POST",
        body: values,
      });
      setRecovery(null);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [data, b, p, n] = await Promise.all([
        apiFetch<{ items: Row[] }>(`/v1/registry/${users === "staff" ? "staff" : entity}`),
        apiFetch<{ items: Row[] }>("/v1/registry/buildings"),
        apiFetch<{ items: Row[] }>("/v1/registry/premises"),
        apiFetch<{ items: Row[] }>("/v1/registry/persons"),
      ]);
      setRows(users === "residents" ? data.items.filter(row => !(row.staff_roles as string[] | undefined)?.length) : data.items);
      setBuildings(b.items);
      setPremises(p.items);
      setPersons(n.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  };
  usePageRefresh(load, !busy && !saving);
  useEffect(() => {
    void load();
  }, [entity]);
  const switchEntity = (key: string) => {
    // Старые строки другой сущности не показываем: при переключении таба
    // колонки меняются сразу, и до загрузки таблица выглядела как «квартиры
    // в табе Здания».
    if (key !== entity) {
      setRows([]);
      setEntity(key as Entity);
    }
  };
  const open = (row: Row | null) => {
    form.resetFields();
    form.setFieldsValue(
      row ?? {
        status: "pending",
        basis: "ownership",
        kind: "apartment",
        role: "owner",
      },
    );
    form.setFields(Object.keys(form.getFieldsValue(true)).map(name => ({ name, touched: false })));
    setEditing(row);
  };
  const options = (data: Row[], label: (r: Row) => string) =>
    data.map((r) => ({ value: String(r.id), label: label(r) }));
  const save = async () => {
    try {
      const values = await form.validateFields();
      if (entity === "buildings") values.construction_phase ??= null;
      setSaving(true);
      setError(null);
      await apiFetch(
        `/v1/registry/${entity}${editing?.id ? `/${editing.id}` : ""}`,
        { method: editing?.id ? "PATCH" : "POST", body: values },
      );
      setEditing(undefined);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const keys =
    entity === "buildings"
      ? ["code", "name", "construction_phase"]
      : entity === "premises"
        ? ["building_code", "kind", "number", "entrance", "floor", "status"]
        : entity === "persons"
          ? ["full_name", "phone_e164", "comment"]
          : ["full_name", "kind", "number", "role", "basis", "status"];
  const remove = async (row: Row) => {
    try {
      setDeleting(String(row.id));
      setError(null);
      await apiFetch(`/v1/registry/${entity}/${row.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setDeleting(null);
    }
  };
  const canDelete = entity === "buildings" || entity === "premises";
  const deleteHint = entity === "buildings"
    ? "Удалится дом вместе со всеми помещениями, связями, приглашениями и анкетами. Обращения сохранятся без привязки. Удаление недоступно при активных аварийных сигналах."
    : "Удалятся связи, приглашения и анкеты помещения. Обращения сохранятся без привязки.";
  const columns = [
    ...(users === "staff" ? [{ title: "Роли", dataIndex: "staff_roles", render: (roles: string[]) => roles.map(role => ROLE_LABELS[role] ?? role).join(", ") }] : []),
    ...keys.map((key) => ({
      title: LABELS[key],
      dataIndex: key,
      key,
      render: (v: unknown) =>
        key === "construction_phase" ? (
          v == null ? "Не указана" : `${v}-я очередь`
        ) : key === "kind" ? (
          displayKind(v)
        ) : key === "role" ? (
          displayRole(v)
        ) : key === "status" ? (
          <Tag>{STATUS[String(v)] ?? String(v)}</Tag>
        ) : (
          String(v ?? "—")
        ),
    })),
    ...(users === "residents" ? [
      { title: "Адрес", key: "address", render: (_: unknown, row: Row) => residentAddress(row) },
      { title: "Статус регистрации", key: "registration_state", dataIndex: "registration_state",
        render: (value: unknown) => <Tag>{REGISTRATION_STATES[String(value ?? "none")] ?? String(value)}</Tag> },
      { title: "Привязанные помещения", key: "linked_premises", render: (_: unknown, row: Row) => residentPremises(row) },
    ] : []),
    {
      title: "Действия",
      key: "actions",
      render: (_: unknown, row: Row) => (
        <Space wrap>
          <Button onClick={() => open(row)}>Изменить</Button>
          {entity === "persons" && (
            <Button onClick={() => void openRecovery(row)}>
              Восстановить Telegram
            </Button>
          )}
          {canDelete && (
            <Popconfirm
              title="Удалить без возможности восстановления?"
              description={deleteHint}
              okText="Удалить"
              cancelText="Отмена"
              okButtonProps={{ danger: true, loading: deleting === String(row.id) }}
              onConfirm={() => void remove(row)}
            >
              <Button danger size="small">Удалить</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
  const field = (key: string, required = true) => (
    <Form.Item
      key={key}
      name={key}
      label={LABELS[key]}
      rules={required ? [{ required: true, message: "Заполните поле" }] : []}
    >
      <Input maxLength={300} />
    </Form.Item>
  );
  const visibleRows = users === "residents" ? rows.filter(row => {
    const links = linkedPremises(row);
    const search = residentSearch.trim().toLocaleLowerCase("ru-RU");
    const searchable = [row.full_name, row.phone_e164, residentAddress(row), residentPremises(row)].join(" ").toLocaleLowerCase("ru-RU");
    const date = row.registered_at ? new Date(String(row.registered_at)).toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" }) : "";
    return (!search || searchable.includes(search))
      && (!registrationState || (row.registration_state ?? "none") === registrationState)
      && (!residentBuilding || links.some(p => p.building_id === residentBuilding))
      && (!hasPremises || (hasPremises === "yes" ? links.length > 0 : links.length === 0))
      && (!registeredFrom || !!date && date >= registeredFrom)
      && (!registeredTo || !!date && date <= registeredTo);
  }) : entity === "buildings" && constructionPhase !== "all"
    ? rows.filter(row => constructionPhase === "unassigned" ? row.construction_phase == null : row.construction_phase === constructionPhase)
    : rows;
  return (
    <PageLayout title={users === "staff" ? "Сотрудники" : users ? "Жители" : "Помещения"}
      actions={users !== "staff" ? <Button type="primary" onClick={() => open(null)}>Добавить запись</Button> : null}
      filters={users === "residents" ? <Space wrap>
        <Input.Search aria-label="Поиск жителей" placeholder="ФИО, телефон или адрес" value={residentSearch}
          onChange={e => setResidentSearch(e.target.value)} style={{ width: 280 }} />
        <Select aria-label="Статус регистрации" placeholder="Все статусы" allowClear value={registrationState}
          onChange={setRegistrationState} style={{ width: 230 }}
          options={Object.entries(REGISTRATION_STATES).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Фильтр по зданию" placeholder="Все здания" allowClear showSearch optionFilterProp="label"
          value={residentBuilding} onChange={setResidentBuilding} style={{ width: 210 }}
          options={options(buildings, b => String(b.name || b.code))} />
        <Select aria-label="Наличие помещений" placeholder="Все привязки" allowClear value={hasPremises}
          onChange={setHasPremises} style={{ width: 220 }} options={[
            { value: "yes", label: "Есть помещения" }, { value: "no", label: "Без помещений" },
          ]} />
        <Input aria-label="Период регистрации с" type="date" value={registeredFrom}
          onChange={e => setRegisteredFrom(e.target.value)} style={{ width: 155 }} />
        <Input aria-label="Период регистрации по" type="date" value={registeredTo}
          onChange={e => setRegisteredTo(e.target.value)} style={{ width: 155 }} />
      </Space> : !users && <>
      <Tabs
        activeKey={entity}
        onChange={switchEntity}
        items={Object.keys(LABELS)
          .filter((k) =>
            ["buildings", "premises", "connections"].includes(k),
          )
          .map((key) => ({ key, label: LABELS[key] }))}
      />
      {entity === "buildings" && <Select
        aria-label="Фильтр по очереди строительства"
        value={constructionPhase}
        onChange={setConstructionPhase}
        style={{ width: "100%", maxWidth: 280 }}
        options={[
          { value: "all", label: "Все очереди" },
          ...CONSTRUCTION_PHASES,
          { value: "unassigned", label: "Не указана" },
        ]}
      />}
      </>}> <Typography.Paragraph type="secondary">
          {users === "staff" ? "Пользователи с действующими служебными полномочиями в доступной области." : users
            ? "Жители без действующих служебных назначений. Совпадение телефона не объединяет карточки."
            : "Здания, помещения и привязки помещений к пользователям. Изменения сохраняются в журнале."}
        </Typography.Paragraph>

      {error && editing === undefined && !recovery && (
        <Alert
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      <ConfigurableTable storageKey={`columns.registry.${users ?? "registry"}.${entity}`} settingsPlacement="page"
        rowKey="id"
        loading={busy}
        dataSource={visibleRows}
        columns={columns}
        scroll={{ x: users === "residents" ? 1500 : 900 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: "Записей пока нет" }}
      />
      <CardDrawer
        open={editing !== undefined || !!recovery}
        title={recovery ? "Восстановление Telegram" : `${editing ? "Изменить" : "Добавить"}: ${users === "staff" ? "Сотрудники" : LABELS[entity]}`}
        closeDisabled={saving}
        hasUnsavedChanges={() => form.isFieldsTouched()}
        onClose={() => { setEditing(undefined); setRecovery(null); }}
        footer={editing !== undefined ? ((close: () => void) => (
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button disabled={saving} onClick={close}>Отмена</Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              Сохранить
            </Button>
          </Space>
        )) : undefined}
      >
        {error && editing !== undefined && !recovery && <Alert type="error" showIcon message={error} />}
        {editing !== undefined && <Form name="registry-record" form={form} layout="vertical">
          {entity === "buildings" && (
            <>
              {field("code")}
              {field("name", false)}
              <Form.Item name="construction_phase" label={LABELS.construction_phase}>
                <Select allowClear placeholder="Не указана" options={CONSTRUCTION_PHASES} />
              </Form.Item>
            </>
          )}
          {entity === "premises" && (
            <>
              <Form.Item
                name="building_id"
                label="Здание"
                rules={[{ required: true }]}
              >
                <Select options={options(buildings, (r) => String(r.code))} />
              </Form.Item>
              <Form.Item
                name="kind"
                label="Тип помещения"
                rules={[{ required: true }]}
              >
                <Select options={KINDS} />
              </Form.Item>
              {field("number")}
              {["entrance", "floor"].map((key) => (
                <Form.Item key={key} name={key} label={LABELS[key]}>
                  <InputNumber precision={0} />
                </Form.Item>
              ))}
            </>
          )}
          {entity === "persons" && (
            <>
              {field("full_name")}
              {field("phone_e164")}
              {field("comment", false)}
              {!editing && (
                <>
                  <Form.Item
                    name="premises_id"
                    label="Помещение"
                    rules={[{ required: true }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={options(
                        premises,
                        (r) =>
                          `${r.building_code} · ${displayKind(r.kind)} ${r.number}`,
                      )}
                    />
                  </Form.Item>
                  {field("source")}
                  {field("processing_basis")}
                </>
              )}
            </>
          )}
          {entity === "connections" && (
            <>
              <Form.Item
                name="person_id"
                label="Человек"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!editing}
                  showSearch
                  optionFilterProp="label"
                  options={options(persons, (r) => String(r.full_name))}
                />
              </Form.Item>
              <Form.Item
                name="premises_id"
                label="Помещение"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!editing}
                  showSearch
                  optionFilterProp="label"
                  options={options(
                    premises,
                    (r) =>
                      `${r.building_code} · ${displayKind(r.kind)} ${r.number}`,
                  )}
                />
              </Form.Item>
              <Form.Item
                name="role"
                label="Отношение"
                rules={[{ required: true }]}
              >
                <Select options={ROLES} />
              </Form.Item>
              <Form.Item
                name="basis"
                label="Основание"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: "initial_registry", label: "Исходный реестр ОСИ" },
                    { value: "ownership", label: "Собственность" },
                    { value: "rent", label: "Аренда" },
                    { value: "family", label: "Семья" },
                    { value: "other", label: "Другое" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="status" label="Состояние">
                <Select
                  options={Object.entries(STATUS)
                    .filter(([v]) => v !== "archived")
                    .map(([value, label]) => ({ value, label }))}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() =>
                  form.getFieldValue("status") === "revoked" ? (
                    <Form.Item
                      name="revoked_reason"
                      label="Причина прекращения"
                      rules={[{ required: true }]}
                    >
                      <Input.TextArea />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
            </>
          )}
        </Form>}
      <ActionPanel
        full
        form={recoveryForm}
        error={error}
        title={`Восстановление Telegram: ${recovery?.full_name ?? ""}`}
        open={!!recovery}
        onCancel={() => setRecovery(null)}
        onOk={() => void recover()}
        busy={saving}
        okText="Перенести привязку"
      >
        <ProcessOverview guidance={{
          title: "Нужно проверить личность и новую анкету",
          description: "Проверьте личность вне системы. Выберите анкету с нового Telegram и укажите, как проверена личность. Прежняя привязка и все прежние сеансы будут отозваны. История, идентификатор человека и роли сохранятся.",
          waitingFor: "Уполномоченный сотрудник",
        }} />
        <Form name="registry-recovery" form={recoveryForm} layout="vertical">
          <Form.Item
            name="registration_id"
            label="Анкета с нового Telegram"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={pending.map((r) => {
                const draft = r.draft as Row;
                return {
                  value: String(r.id),
                  label: `${draft.full_name} · ${draft.phone_e164}`,
                };
              })}
            />
          </Form.Item>
          <Form.Item
            name="verified_basis"
            label="Как проверены личность и новый Telegram-аккаунт"
            rules={[{ required: true }]}
          >
            <Input.TextArea maxLength={300} />
          </Form.Item>
        </Form>
      </ActionPanel>
      </CardDrawer>

    </PageLayout>
  );
}
