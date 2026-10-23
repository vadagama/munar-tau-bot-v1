import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { TelegramHandle } from "../components/telegram-handle";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useEffect, useState } from "react";
import { Alert, Input, Space, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { displayKind, displayRole } from "./registry";
type Row = Record<string, unknown>;
export function InvitesPage() {
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [search, setSearch] = useState("");
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
  const visible = rows.filter((r) => {
    const trim = search.trim().toLocaleLowerCase("ru-RU");
    if (!trim) return true;
    const searchable = [
      r.created_by_name,
      r.created_by_telegram ? `@${String(r.created_by_telegram)}` : "",
      r.building_code,
      displayKind(r.kind),
      r.number,
      displayRole(r.role),
    ].join(" ").toLocaleLowerCase("ru-RU");
    return searchable.includes(trim);
  });
  return (
    <PageLayout title="Приглашения"
      filters={<Space wrap>
        <Input.Search aria-label="Поиск приглашений" placeholder="Кто пригласил, Telegram или помещение"
          value={search} onChange={e => setSearch(e.target.value)} style={{ width: 320 }} />
      </Space>}>
      <Typography.Paragraph type="secondary">
        Подтверждённый собственник создаёт приглашение в боте. Оно действует 72
        календарных часа по текущему регламенту. Приглашение не выдаёт статус
        собственника.
      </Typography.Paragraph>
      {error && <Alert showIcon type="error" message={error} />}
      <ConfigurableTable storageKey="columns.invites" settingsPlacement="page"
        rowKey="id"
        loading={busy}
        dataSource={visible}
        scroll={{ x: 800 }}
        locale={{ emptyText: rows.length ? "По выбранным условиям ничего не найдено" : "Записей пока нет" }}
        columns={[
          { title: "Пригласил", dataIndex: "created_by_name" },
          {
            title: "Telegram",
            dataIndex: "created_by_telegram",
            render: (v) => <TelegramHandle username={v} />,
          },
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
