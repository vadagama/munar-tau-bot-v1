import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useEffect, useState } from "react";
import { Alert, Typography } from "antd";
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
  usePageRefresh(load, !busy);
  useEffect(() => {
    void load();
  }, []);
  return (
    <PageLayout title="Приглашения">
      <Typography.Paragraph type="secondary">
        Подтверждённый собственник создаёт приглашение в боте. Оно действует 72
        календарных часа по текущему регламенту. Приглашение не выдаёт статус
        собственника.
      </Typography.Paragraph>
      {error && <Alert showIcon type="error" message={error} />}
      <ConfigurableTable storageKey="columns.invites" settingsPlacement="page"
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
    </PageLayout>
  );
}
