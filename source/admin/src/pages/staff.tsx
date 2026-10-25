import { FilterOutlined } from "@ant-design/icons";
import { PageSearch } from "../components/page-controls";
import { PROCESS_MANAGER_ROLES } from "../components/process-guidance";
import { ProcessOverview, ProcessActions } from "../components/process-card";
import { ConfigurableTable } from "../components/configurable-table";
import { StaffRoleForm } from "./staff-form";
import { StaffDetails } from "./staff-details";
import type { StaffCard, StaffList, StaffRow } from "./staff-types";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { PageLayout } from "../components/page-layout";
import { TelegramHandle } from "../components/telegram-handle";
import { CardDrawer } from "./card-drawer";
import { ActionPanel } from "./action-panel";
import { apiFetch } from "../lib/api";
import { usePageRefresh } from "../lib/use-page-refresh";
import {
  isVersionConflict,
  VERSION_CONFLICT_MESSAGE,
} from "./version-conflict";
import { ROLE_LABELS } from "../../../core/src/pdp/roles";
import type { StaffRole } from "../../../core/src/pdp/types";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Ошибка запроса";
export function StaffPage() {
  const [data, setData] = useState<StaffList>({
    items: [],
    available_roles: [],
    can_edit: false,
  });
  const [card, setCard] = useState<StaffCard | null>(null),
    [mode, setMode] = useState<"create" | "edit" | "remove" | null>(null);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [role, setRole] = useState<StaffRole>();
  const [status, setStatus] = useState("active"),
    [candidates, setCandidates] = useState<StaffRow[]>([]),
    [finding, setFinding] = useState(false);
  const [form] = Form.useForm(),
    key = useRef(crypto.randomUUID()),
    generation = useRef(0),
    candidateGeneration = useRef(0);
  async function load(background = false) {
    const current = ++generation.current;
    setBusy(true);
    try {
      const next = await apiFetch<StaffList>("/v1/staff");
      if (current === generation.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (current === generation.current) {
        setError(message(e));
        const status = typeof e === "object" && e !== null && "status" in e
          ? e.status
          : undefined;
        if (!background || status === 401 || status === 403) {
          setData({ items: [], available_roles: [], can_edit: false });
          setCard(null);
          setMode(null);
        }
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      candidateGeneration.current++;
    };
  }, []);
  usePageRefresh(() => load(true), !busy && !saving);
  async function open(id: string) {
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    setCard(null);
    setMode(null);
    try {
      const next = await apiFetch<StaffCard>(`/v1/staff/${id}`);
      if (current === generation.current) setCard(next);
    } catch (e) {
      if (current === generation.current) setError(message(e));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function findCandidates(search = "") {
    const current = ++candidateGeneration.current;
    setFinding(true);
    try {
      const result = await apiFetch<{ items: StaffRow[] }>(
        "/v1/staff/candidates/search",
        { method: "POST", body: { query: search } },
      );
      if (current === candidateGeneration.current) setCandidates(result.items);
    } catch (e) {
      if (current === candidateGeneration.current) setActionError(message(e));
    } finally {
      if (current === candidateGeneration.current) setFinding(false);
    }
  }
  function begin(next: "create" | "edit" | "remove") {
    setActionError(null);
    key.current = crypto.randomUUID();
    form.resetFields();
    form.setFieldsValue({
      roles: next === "edit" ? card?.roles : [],
      reason: "",
    });
    if (next === "create") {
      setCard(null);
      setCandidates([]);
      void findCandidates();
    }
    setMode(next);
  }
  async function choosePerson(id: string) {
    const current = ++candidateGeneration.current;
    setFinding(true);
    setCard(null);
    setActionError(null);
    try {
      const next = await apiFetch<StaffCard>(`/v1/staff/${id}`);
      if (current === candidateGeneration.current) setCard(next);
    } catch (e) {
      if (current === candidateGeneration.current) setActionError(message(e));
    } finally {
      if (current === candidateGeneration.current) setFinding(false);
    }
  }
  async function save(values: { roles: StaffRole[]; reason: string }) {
    if (!card || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/v1/staff/${card.id}/roles`, {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          roles: mode === "remove" ? [] : values.roles,
          reason: values.reason,
          expected_version: card.version,
        },
      });
      setMode(null);
      form.resetFields();
      const currentId = card.id;
      await load();
      await open(currentId);
    } catch (e) {
      setActionError(message(e));
      if (isVersionConflict(e)) {
        try {
          setCard(await apiFetch<StaffCard>(`/v1/staff/${card.id}`));
          setActionError(VERSION_CONFLICT_MESSAGE);
        } catch (readError) {
          setCard(null);
          setMode(null);
          setError(message(readError));
        }
      }
    } finally {
      setSaving(false);
    }
  }
  const rows = data.items.filter((row) =>
    (status === "all" ||
      (status === "active"
        ? row.roles.length > 0
        : status === "scheduled"
        ? !row.roles.length && row.scheduled
        : !row.roles.length && !row.scheduled)) &&
    (!role || row.roles.includes(role)) &&
    `${row.full_name} ${row.phone_e164} ${row.telegram_username ? `@${row.telegram_username}` : ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  return (
    <PageLayout
      title="Сотрудники"
      actions={data.can_edit && (
        <Button
          type="primary"
          disabled={busy || saving}
          onClick={() => begin("create")}
        >
          Добавить сотрудника
        </Button>
      )}
      filters={
        <Space wrap>
          <PageSearch
            aria-label="Поиск сотрудников"
            placeholder="ФИО, телефон или Telegram"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            allowClear
          />
          <Select prefix={<FilterOutlined aria-hidden />}
            aria-label="Состояние сотрудника"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Действующие" },
              { value: "former", label: "Бывшие сотрудники" },
              { value: "scheduled", label: "Будущие назначения" },
              { value: "all", label: "Все" },
            ]}
          />
          <Select prefix={<FilterOutlined aria-hidden />}
            aria-label="Фильтр по роли"
            allowClear
            placeholder="Все роли"
            value={role}
            onChange={setRole}
            style={{ minWidth: 200 }}
            options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Space>
      }
    >
      {error && <Alert type="error" message={error} showIcon />}
      <ConfigurableTable storageKey="columns.staff" onMobileRowClick={row => void open(row.id)} settingsPlacement="page"
        rowKey="id"
        dataSource={rows}
        mobileRender={row => <div className="mobile-summary">
          <Button type="link" onClick={() => void open(row.id)}>{row.full_name}</Button>
          <div className="mobile-summary__tags">{row.roles.length ? row.roles.map(r => <Tag key={r}>{ROLE_LABELS[r]}</Tag>) : <span>{row.scheduled ? "Будущее назначение" : "Бывший сотрудник"}</span>}</div>
          <div>{row.phone_e164}</div><TelegramHandle username={row.telegram_username} />
          <Typography.Text type="secondary">Открытых заданий: {row.open_tasks}</Typography.Text>
        </div>}
        loading={busy}
        scroll={{ x: 650 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: "Сотрудников не найдено" }}
        columns={[
          {
            title: "ФИО",
            key: "name",
            render: (_, row: StaffRow) => (
              <Button
                type="link"
                onClick={() => void open(row.id)}
              >
                {row.full_name}
              </Button>
            ),
          },
          { title: "Телефон", dataIndex: "phone_e164" },
          {
            title: "Telegram",
            dataIndex: "telegram_username",
            render: (v) => <TelegramHandle username={v} />,
          },
          {
            title: "Роли",
            key: "roles",
            render: (_, row: StaffRow) =>
              row.roles.length
                ? row.roles.map((r) => <Tag key={r}>{ROLE_LABELS[r]}</Tag>)
                : (
                  <Typography.Text type="secondary">
                    {row.scheduled ? "Будущее назначение" : "Бывший сотрудник"}
                  </Typography.Text>
                ),
          },
          { title: "Открытые задания", dataIndex: "open_tasks" },
        ]}
      />
      <CardDrawer
        open={!!card || mode === "create"}
        title={mode === "create" ? "Добавить сотрудника" : card?.full_name}
        onClose={() => {
          setCard(null);
          setMode(null);
          candidateGeneration.current++;
        }}
        closeDisabled={saving}
      >
        <ActionPanel
          open={mode !== null}
          full={mode === "create"}
          busy={saving || finding}
          form={form}
          error={actionError}
          title={mode === "create"
            ? "Добавить сотрудника"
            : mode === "remove"
            ? "Прекращение полномочий"
            : "Изменение ролей"}
          onCancel={() => {
            if (mode === "create") setCard(null);
            setMode(null);
            candidateGeneration.current++;
          }}
        >
          <StaffRoleForm
            form={form}
            mode={mode}
            card={card}
            saving={saving}
            finding={finding}
            candidates={candidates}
            availableRoles={data.available_roles}
            onSave={save}
            onFind={findCandidates}
            onChoose={choosePerson}
            onChange={() => {
              key.current = crypto.randomUUID();
            }}
          />
        </ActionPanel>
        {card && (
          <div key={card.id} className="process-card-content">
            <ProcessOverview guidance={{
              title: "Проверьте полномочия и открытые обязанности",
              description: "Изменения ролей требуют основания. Прекращение полномочий не передаёт открытые задания, обращения и расписания автоматически: их нужно передать явно.",
              waitingFor: `${PROCESS_MANAGER_ROLES} — в пределах своих полномочий`,
            }}>
            {card.can_edit && (
              <ProcessActions primary="edit">
                <Button key="edit" onClick={() => begin("edit")}>Изменить роли</Button>
                {(card.can_remove ?? !!card.roles.length) && (
                  <Button key="remove"
                    danger
                    onClick={() => begin("remove")}
                  >
                    Прекратить полномочия
                  </Button>
                )}
              </ProcessActions>
            )}
            </ProcessOverview>
            <StaffDetails card={card} />
          </div>
        )}
      </CardDrawer>
    </PageLayout>
  );
}
