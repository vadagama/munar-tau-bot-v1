import { FilterOutlined } from "@ant-design/icons";
import { PageSearch } from "../components/page-controls";
import { RegistryFilters, EMPTY_REGISTRY_FILTERS, filterRegistryRows, type RegistryFilterValues, type RegistrySection } from "./registry-filters";
import { ProcessOverview } from "../components/process-card";
import { REGISTRATION_REVIEWER_ROLES } from "../components/process-guidance";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { TelegramHandle } from "../components/telegram-handle";
import { usePageRefresh } from "../lib/use-page-refresh";
import { ActionPanel } from "./action-panel";
import { CardDrawer } from "./card-drawer";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format-date";

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
  telegram_username: "Telegram",
  name: "Название",
  construction_phase: "Очередь строительства",
  kind: "Тип",
  number: "Номер",
  role: "Отношение",
  status: "Состояние",
  basis: "Основание",
  created_at: "Дата",
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
// Основание привязки (REG-02): в таблице и поиске — русские подписи, а не коды.
const BASES: Record<string, string> = {
  initial_registry: "Исходный реестр ОСИ",
  ownership: "Собственность",
  rent: "Аренда",
  family: "Семья",
  other: "Другое",
};
export const displayBasis = (value: unknown) =>
  BASES[String(value ?? "")] ?? String(value ?? "");
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

// Каскадное необратимое удаление здания: подтверждение вводом названия
// и явный список последствий — защита соответствует цене ошибки.
function DeleteBuildingModal({ row, onClose, onDeleted }: {
  row: Row;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const name = String(row.name ?? row.code ?? "").trim();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name !== "" && confirm.trim() === name;
  return (
    <Modal
      open
      title={`Удаление здания «${name || "без названия"}»`}
      okText="Удалить безвозвратно"
      okButtonProps={{ danger: true, disabled: !ready, loading: busy }}
      cancelText="Отмена"
      onCancel={onClose}
      onOk={async () => {
        try {
          setBusy(true);
          setError(null);
          await apiFetch(`/v1/registry/buildings/${row.id}`, { method: "DELETE" });
          await onDeleted();
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось удалить здание");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text>Удаление необратимо. Будут удалены:</Typography.Text>
        <List
          size="small"
          dataSource={[
            "Все помещения здания",
            "Привязки жителей к помещениям",
            "Приглашения и анкеты регистрации",
          ]}
          renderItem={(item) => <List.Item style={{ paddingBlock: 2 }}>{item}</List.Item>}
        />
        <Typography.Text type="secondary">
          Обращения сохранятся без привязки к зданию. Удаление недоступно при активных аварийных сигналах.
        </Typography.Text>
        <Typography.Text>
          Для подтверждения введите название здания: <Typography.Text strong>{name}</Typography.Text>
        </Typography.Text>
        <Input
          aria-label="Подтверждение удаления"
          placeholder={name}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="off"
        />
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Modal>
  );
}
const residentAddress = (row: Row): string => [...new Set(linkedPremises(row).map(p =>
  String(p.building_name ?? p.building_code ?? "—"),
))].join(", ") || "Адрес не указан";
const residentPremises = (row: Row): string => linkedPremises(row).map(p =>
  `${String(p.building_name ?? p.building_code ?? "—")} · ${displayKind(p.kind)} ${p.number} · ${displayRole(p.role)}`,
).join("; ") || "Помещения не привязаны";
// Удаление жителя = удаление его основной анкеты (ADR-16): доступ закрывается
// необратимо, поэтому требуются основание и ключ идемпотентности; сервер ещё раз
// проверяет полномочия и версию анкеты (registration.manage).
function DeleteResidentModal({ row, onClose, onDeleted }: {
  row: Row;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteKey = useRef(crypto.randomUUID());
  const submit = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setError(null);
      await apiFetch(`/v1/registrations/${row.registration_id}/manage`, {
        method: "POST",
        idempotencyKey: deleteKey.current,
        body: { operation: "delete", expected_version: row.registration_version, reason: values.reason },
      });
      await onDeleted();
      onClose();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`Удаление жителя: ${String(row.full_name ?? "")}`}
      okText="Удалить"
      okButtonProps={{ danger: true, loading: busy }}
      cancelText="Отмена"
      onCancel={onClose}
      onOk={() => void submit()}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <ProcessOverview guidance={{
          title: "Нужно подтвердить прекращение доступа",
          description: "Проверьте человека и основание удаления. Сохранение прекратит доступ, роли и связи; обращения и история сохранятся.",
          waitingFor: REGISTRATION_REVIEWER_ROLES,
        }} />
        <Alert showIcon type="warning" message="Доступ к боту и кабинету закроется. Связи с помещениями и служебные роли прекратятся. История обращений и операций сохранится." />
        <Form name="resident-delete" form={form} layout="vertical">
          <Form.Item
            name="reason"
            label="Основание удаления"
            rules={[{ required: true, whitespace: true, message: "Укажите основание" }]}
          >
            <Input.TextArea maxLength={300} />
          </Form.Item>
        </Form>
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Modal>
  );
}
export function RegistryPage({ users, section = "premises" }: { users?: "residents" | "staff"; section?: RegistrySection }) {
  const entity: Entity = users ? "persons" : section;
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [saving, setSaving] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null),
    [deleteBuilding, setDeleteBuilding] = useState<Row | null>(null),
    [deleteResident, setDeleteResident] = useState<Row | null>(null),
    [buildings, setBuildings] = useState<Row[]>([]),
    [premises, setPremises] = useState<Row[]>([]),
    [persons, setPersons] = useState<Row[]>([]);
  const [residentSearch, setResidentSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [registrationState, setRegistrationState] = useState<string>();
  const [residentBuilding, setResidentBuilding] = useState<string>();
  const [hasPremises, setHasPremises] = useState<string>();
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [filters, setFilters] = useState<RegistryFilterValues>(EMPTY_REGISTRY_FILTERS);
  const [page, setPage] = useState(1);
  const [form] = Form.useForm();
  const [recovery, setRecovery] = useState<Row | null>(null),
    [pending, setPending] = useState<Row[]>([]);
  const [recoveryForm] = Form.useForm();
  const [unlink, setUnlink] = useState<Row | null>(null),
    [unlinkSaving, setUnlinkSaving] = useState(false),
    [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [unlinkForm] = Form.useForm();
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

  // Отвязка (REG-11): прекращение связи с причиной; сервер проверяет
  // права (registry.write) и каскад для собственника.
  const openUnlink = (row: Row) => {
    unlinkForm.resetFields();
    setUnlinkError(null);
    setUnlink(row);
  };
  const submitUnlink = async () => {
    if (!unlink) return;
    try {
      const values = await unlinkForm.validateFields();
      setUnlinkSaving(true);
      setUnlinkError(null);
      await apiFetch(`/v1/registry/connections/${unlink.id}`, {
        method: "PATCH",
        body: { status: "revoked", revoked_reason: values.revoked_reason },
      });
      setUnlink(null);
      await load();
    } catch (e) {
      if (e instanceof Error) setUnlinkError(e.message);
    } finally {
      setUnlinkSaving(false);
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
      ? ["name", "construction_phase"]
      : entity === "premises"
        ? ["building_code", "kind", "number", "entrance", "floor", "status"]
        : entity === "persons"
          ? users
            ? ["full_name", "phone_e164", "telegram_username", "comment"]
            : ["full_name", "phone_e164", "comment"]
          : ["full_name", "phone_e164", "building_code", "kind", "number", "role", "basis", "created_at", "status"];
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
  const renderActions = (row: Row) => (
        <Space wrap>
          <Button onClick={() => open(row)}>Изменить</Button>
          {entity === "connections" && ["active", "pending"].includes(String(row.status)) && (
            <Button danger onClick={() => openUnlink(row)}>
              Отвязать
            </Button>
          )}
          {entity === "persons" && (
            <Button onClick={() => void openRecovery(row)}>
              Восстановить Telegram
            </Button>
          )}
          {canDelete && entity === "buildings" && (
            <Button danger onClick={() => setDeleteBuilding(row)}>
              Удалить
            </Button>
          )}
          {users === "residents" && Boolean(row.can_manage) && (
            <Button danger onClick={() => setDeleteResident(row)}>
              Удалить
            </Button>
          )}
          {canDelete && entity === "premises" && (
            <Popconfirm
              title="Удалить без возможности восстановления?"
              description={deleteHint}
              okText="Удалить"
              cancelText="Отмена"
              okButtonProps={{ danger: true, loading: deleting === String(row.id) }}
              onConfirm={() => void remove(row)}
            >
              <Button danger>Удалить</Button>
            </Popconfirm>
          )}
        </Space>
      );
  const columns = [
    ...(users === "staff" ? [{ title: "Роли", dataIndex: "staff_roles", render: (roles: string[]) => roles.map(role => ROLE_LABELS[role] ?? role).join(", ") }] : []),
    ...keys.filter(key => entity !== "premises" || !["entrance", "floor"].includes(key)).map((key) => ({
      title: LABELS[key],
      dataIndex: key,
      key,
      render: (v: unknown, row: Row) =>
        key === "construction_phase" ? (
          v == null ? "Не указана" : `${v}-я очередь`
        ) : key === "building_code" ? (
          String(row.building_name ?? v ?? "—")
        ) : key === "kind" ? (
          displayKind(v)
        ) : key === "role" ? (
          displayRole(v)
        ) : key === "basis" ? (
          displayBasis(v)
        ) : key === "created_at" ? (
          formatDateTime(v)
        ) : key === "telegram_username" ? (
          <TelegramHandle username={v} />
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
      render: (_: unknown, row: Row) => renderActions(row),
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
  const buildingById = new Map(buildings.map(row => [row.id, row]));
  const personById = new Map(persons.map(row => [row.id, row]));
  const directoryRows = rows.map(row => {
    const building = buildingById.get(row.building_id);
    const person = personById.get(row.person_id);
    return { ...row, building_code: row.building_code ?? building?.name ?? building?.code,
      building_name: building?.name, construction_phase: row.construction_phase ?? building?.construction_phase,
      phone_e164: row.phone_e164 ?? person?.phone_e164 };
  });
  const visibleRows = users === "residents" ? rows.filter(row => {
    const links = linkedPremises(row);
    const search = residentSearch.trim().toLocaleLowerCase("ru-RU");
    const searchable = [row.full_name, row.phone_e164, row.telegram_username ? `@${row.telegram_username}` : "", residentAddress(row), residentPremises(row)].join(" ").toLocaleLowerCase("ru-RU");
    const date = row.registered_at ? new Date(String(row.registered_at)).toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" }) : "";
    return (!search || searchable.includes(search))
      && (!registrationState || (row.registration_state ?? "none") === registrationState)
      && (!residentBuilding || links.some(p => p.building_id === residentBuilding))
      && (!hasPremises || (hasPremises === "yes" ? links.length > 0 : links.length === 0))
      && (!registeredFrom || !!date && date >= registeredFrom)
      && (!registeredTo || !!date && date <= registeredTo);
  }) : users === "staff" ? rows.filter(row => {
    const search = staffSearch.trim().toLocaleLowerCase("ru-RU");
    if (!search) return true;
    const roles = (row.staff_roles as string[] | undefined) ?? [];
    const searchable = [row.full_name, row.phone_e164, row.telegram_username ? `@${row.telegram_username}` : "", row.comment,
      ...roles.map(role => ROLE_LABELS[role] ?? role)].join(" ").toLocaleLowerCase("ru-RU");
    return searchable.includes(search);
  }) : users ? rows : filterRegistryRows(directoryRows, filters, KINDS, ROLES, STATUS, BASES, section);
  return (
    <PageLayout title={users === "staff" ? "Сотрудники" : users ? "Жители" : LABELS[entity]}
      actions={users !== "staff" ? <Button type="primary" onClick={() => open(null)}>Добавить запись</Button> : null}
      filters={users === "residents" ? <Space wrap>
        <PageSearch aria-label="Поиск жителей" placeholder="ФИО, телефон, Telegram или адрес" value={residentSearch}
          onChange={e => setResidentSearch(e.target.value)} style={{ width: 280 }} />
        <Select prefix={<FilterOutlined aria-hidden />} aria-label="Статус регистрации" placeholder="Все статусы" allowClear value={registrationState}
          onChange={setRegistrationState} style={{ width: 230 }}
          options={Object.entries(REGISTRATION_STATES).map(([value, label]) => ({ value, label }))} />
        <Select prefix={<FilterOutlined aria-hidden />} aria-label="Фильтр по зданию" placeholder="Все здания" allowClear showSearch optionFilterProp="label"
          value={residentBuilding} onChange={setResidentBuilding} style={{ width: 210 }}
          options={options(buildings, b => String(b.name || b.code))} />
        <Select prefix={<FilterOutlined aria-hidden />} aria-label="Наличие помещений" placeholder="Все привязки" allowClear value={hasPremises}
          onChange={setHasPremises} style={{ width: 220 }} options={[
            { value: "yes", label: "Есть помещения" }, { value: "no", label: "Без помещений" },
          ]} />
        <Input aria-label="Период регистрации с" type="date" value={registeredFrom}
          onChange={e => setRegisteredFrom(e.target.value)} style={{ width: 155 }} />
        <Input aria-label="Период регистрации по" type="date" value={registeredTo}
          onChange={e => setRegisteredTo(e.target.value)} style={{ width: 155 }} />
      </Space> : users === "staff" ? <Space wrap>
        <PageSearch aria-label="Поиск сотрудников" placeholder="ФИО, телефон, Telegram или роль" value={staffSearch}
          onChange={e => setStaffSearch(e.target.value)} style={{ width: 320 }} />
      </Space> : !users && <RegistryFilters section={section} values={filters}
        onChange={values => { setFilters(values); setPage(1); }} buildings={buildings} kinds={KINDS} roles={ROLES} statuses={STATUS} />}> <Typography.Paragraph className="cabinet-page__intro" type="secondary">
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
        mobileRender={row => <div className="mobile-summary">
          <Typography.Text strong>{String(row.full_name ?? row.name ?? `${row.building_name ?? row.building_code ?? ""} · ${displayKind(row.kind)} ${row.number ?? ""}`)}</Typography.Text>
          {users === "residents" && <Tag>{REGISTRATION_STATES[String(row.registration_state ?? "none")] ?? String(row.registration_state)}</Tag>}
          {row.phone_e164 != null && <div>{String(row.phone_e164)}</div>}
          {row.telegram_username != null && <TelegramHandle username={row.telegram_username} />}
          {users === "residents" && <div>{linkedPremises(row).length ? linkedPremises(row).map((p, i) => <div key={String(p.id ?? i)}>{String(p.building_name ?? p.building_code ?? "—")} · {displayKind(p.kind)} {String(p.number)} · {displayRole(p.role)}</div>) : "Помещения не привязаны"}</div>}
          {row.comment ? <Typography.Paragraph>{String(row.comment)}</Typography.Paragraph> : null}
          {entity === "buildings" && <Typography.Text type="secondary">{row.construction_phase == null ? "Очередь не указана" : `${row.construction_phase}-я очередь`}</Typography.Text>}
          {entity === "connections" && <><div>{String(row.building_name ?? row.building_code ?? "")} · {displayKind(row.kind)} {String(row.number ?? "")}</div><div>{displayRole(row.role)} · {displayBasis(row.basis)}</div><Typography.Text type="secondary">{formatDateTime(row.created_at)}</Typography.Text></>}
          {users !== "residents" && row.status != null && <div><Tag>{STATUS[String(row.status)] ?? String(row.status)}</Tag></div>}
          <div className="mobile-summary__actions">{renderActions(row)}</div>
        </div>}
        scroll={{ x: users === "residents" ? 1500 : 900 }}
        pagination={{ pageSize: 20, showSizeChanger: true, ...(!users ? { current: page, onChange: setPage } : {}) }}
        locale={{ emptyText: rows.length ? "По выбранным условиям ничего не найдено" : "Записей пока нет" }}
      />
      {deleteBuilding && (
        <DeleteBuildingModal
          row={deleteBuilding}
          onClose={() => setDeleteBuilding(null)}
          onDeleted={async () => { await load(); }}
        />
      )}
      <Modal
        title="Отвязать помещение"
        open={unlink !== null}
        okText="Отвязать"
        okButtonProps={{ danger: true, loading: unlinkSaving }}
        cancelText="Отмена"
        onCancel={() => { if (!unlinkSaving) setUnlink(null); }}
        onOk={() => void submitUnlink()}
      >
        {unlink !== null && (
          <Form form={unlinkForm} layout="vertical" onFinish={() => void submitUnlink()}>
            <Typography.Paragraph>
              Прекратить привязку «{String(unlink.full_name ?? "")}» к помещению
              {" "}{String(unlink.building_code ?? "—")} · {displayKind(unlink.kind)} {String(unlink.number ?? "")}?
              Пользователь потеряет доступ к помещению, получит уведомление, а действие сохранится в журнале.
            </Typography.Paragraph>
            {unlink.role === "owner" && (
              <Typography.Paragraph>
                Связи других пользователей, подтверждённые этим собственником, и их приглашения также будут прекращены.
              </Typography.Paragraph>
            )}
            {unlinkError && <Alert type="error" showIcon message={unlinkError} style={{ marginBottom: 16 }} />}
            <Form.Item
              name="revoked_reason"
              label="Причина отвязки"
              rules={[{ required: true, message: "Укажите причину отвязки" }]}
            >
              <Input.TextArea maxLength={300} />
            </Form.Item>
          </Form>
        )}
      </Modal>
      {deleteResident && (
        <DeleteResidentModal
          row={deleteResident}
          onClose={() => setDeleteResident(null)}
          onDeleted={async () => { await load(); }}
        />
      )}
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
              {field("name")}
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
                <Select options={options(buildings, (r) => String(r.name || r.code))} />
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
                          `${r.building_name || r.building_code} · ${displayKind(r.kind)} ${r.number}`,
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
                      `${r.building_name || r.building_code} · ${displayKind(r.kind)} ${r.number}`,
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
          waitingFor: "Администратор, председатель ОСИ или техадминистратор",
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
