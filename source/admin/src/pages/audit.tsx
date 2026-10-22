import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  Alert,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { ApiClientError, apiFetch } from "../lib/api";
import type { AuditEntryJson, AuditListResponse } from "../lib/types";

const PAGE_SIZE = 50;

const ENTITY_TYPES = [
  { value: "staff_assignment", label: "Назначения" },
  { value: "access_session", label: "Сеансы" },
  { value: "emulation_session", label: "Эмуляция" },
  { value: "person", label: "Персоны" },
  { value: "audit", label: "Чтение журнала" },
  { value: "access", label: "Отказы доступа" },
];

interface AuditFilter {
  entityType?: string;
  actorPersonId?: string;
  range: [number, number] | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU");
}

// Журнал действий (Task 7, AUD-02): фильтры entity/actor/период, курсорная
// пагинация. Область записей фильтрует сервер (председатель — всё,
// администратор — свои дома, техадмин — технические события).
export function AuditPage() {
  const [filter, setFilter] = useState<AuditFilter>({ range: null });
  const [entries, setEntries] = useState<AuditEntryJson[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => ({
    entity_type: filter.entityType,
    actor_person_id: filter.actorPersonId,
    from: filter.range?.[0] !== undefined ? new Date(filter.range[0]).toISOString() : undefined,
    to: filter.range?.[1] !== undefined ? new Date(filter.range[1]).toISOString() : undefined,
    limit: String(PAGE_SIZE),
    cursor: cursor ?? undefined,
  }), [filter, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await apiFetch<AuditListResponse>("/v1/audit", { query });
      setEntries((previous) =>
        cursor === null ? page.entries : [...previous, ...page.entries],
      );
      setNextCursor(page.next_cursor);
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Ошибка загрузки журнала");
    } finally {
      setLoading(false);
    }
  }, [query, cursor]);

  usePageRefresh(() => cursor === null ? load() : setCursor(null), !loading);
  useEffect(() => {
    void load();
    // Перезагрузка — на смену фильтра или курсора.
  }, [load]);

  const changeFilter = (patch: Partial<AuditFilter>) => {
    setFilter((previous) => ({ ...previous, ...patch }));
    setCursor(null);
    setEntries([]);
  };

  const columns: ColumnsType<AuditEntryJson> = [
    {
      title: "Время",
      dataIndex: "at",
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: "Действие",
      dataIndex: "action",
      width: 220,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "Сущность",
      key: "entity",
      width: 200,
      render: (_: unknown, record: AuditEntryJson) => (
        <Space size={4}>
          <Tag>{record.entity_type}</Tag>
          {record.entity_id !== null && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {record.entity_id.slice(0, 8)}…
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: "Актор",
      dataIndex: "actor_person_id",
      width: 220,
      render: (value: string | null, record: AuditEntryJson) =>
        value === null ? (
          <Typography.Text type="secondary">система</Typography.Text>
        ) : (
          <Space size={4}>
            <Typography.Text style={{ fontSize: 12 }}>{value.slice(0, 8)}…</Typography.Text>
            {record.emulated_person_id !== null && (
              <Tag color="orange" title={`Эмулируемая персона: ${record.emulated_person_id}`}>
                эмуляция
              </Tag>
            )}
          </Space>
        ),
    },
    {
      title: "Причина",
      dataIndex: "reason",
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
  ];

  return (
    <PageLayout title="Журнал действий" filters={<Space wrap>
        <Select
          allowClear
          placeholder="Тип сущности"
          style={{ width: 200 }}
          options={ENTITY_TYPES}
          value={filter.entityType}
          onChange={(value) => changeFilter({ entityType: value })}
        />
        <Input.Search
          allowClear
          placeholder="Актор (person id)"
          style={{ width: 280 }}
          onSearch={(value) => changeFilter({ actorPersonId: value || undefined })}
        />
        <DatePicker.RangePicker
          showTime
          onChange={(value) =>
            changeFilter({
              range: value === null ? null : [value[0]!.valueOf(), value[1]!.valueOf()],
            })
          }
        />
      </Space>}>
      {error !== null && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <ConfigurableTable storageKey="columns.audit" settingsPlacement="page"
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={entries}
        loading={loading}
        pagination={false}
        expandable={{
          expandedRowRender: (record: AuditEntryJson) => (
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
              {JSON.stringify({ before: record.before, after: record.after, meta: record.meta, scope_buildings: record.scope_buildings }, null, 2)}
            </pre>
          ),
        }}
      />
      {nextCursor !== null && (
        <Button
          style={{ marginTop: 16 }}
          loading={loading}
          onClick={() => setCursor(nextCursor)}
        >
          Загрузить ещё
        </Button>
      )}
    </PageLayout>
  );
}
