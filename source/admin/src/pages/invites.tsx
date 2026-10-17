import { useEffect, useState } from "react";
import { Alert, Button, Space, Table, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { displayKind, displayRole } from "./registry";
type Row = Record<string, unknown>;
export function InvitesPage() {
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(
        (await apiFetch<{ items: Row[] }>("/v1/registrations/invites")).items,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={2}>Приглашения</Typography.Title>
      <Typography.Paragraph type="secondary">
        Подтверждённый собственник создаёт приглашение в боте. Оно действует 72
        календарных часа по текущему регламенту. Приглашение не выдаёт статус
        собственника.
      </Typography.Paragraph>
      {error && <Alert showIcon type="error" message={error} />}
      <Button loading={busy} onClick={() => void load()}>
        Обновить
      </Button>
      <Table
        rowKey="id"
        loading={busy}
        dataSource={rows}
        scroll={{ x: 800 }}
        columns={[
          { title: "Пригласил", dataIndex: "created_by_name" },
          {
            title: "Помещение",
            render: (_, r) =>
              `${r.building_code} · ${displayKind(r.kind)} ${r.number}`,
          },
          { title: "Отношение", dataIndex: "role", render: displayRole },
          {
            title: "Состояние",
            dataIndex: "status",
            render: (v) =>
              ({
                active: "Действует",
                used: "Использовано",
                expired: "Истекло",
                revoked: "Отозвано",
              })[String(v)] ?? String(v),
          },
          {
            title: "Действует до",
            dataIndex: "expires_at",
            render: (v) => new Date(String(v)).toLocaleString("ru-RU"),
          },
        ]}
      />
    </Space>
  );
}
