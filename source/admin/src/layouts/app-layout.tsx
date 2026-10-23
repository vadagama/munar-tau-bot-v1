import { EmulationRoleSelect } from "./emulation-role-select";
import { PAGE_REFRESH_EVENT, usePageRefresh } from "../lib/use-page-refresh";
import { useState } from "react";
import { Alert, Button, Layout, Menu, Space, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLogout } from "@refinedev/core";

import {
  canSeeAudit,
  canSeeTasks,
  canSeeTemplates,
  canUseEmulation,
  useCabinetIdentity,
} from "../lib/identity";
import { apiFetch } from "../lib/api";

const { Header, Sider, Content } = Layout;

// Баннер режима эмуляции (Task 7, HLD 10.8): имя персоны и пометка
// журналирования; завершение сеанса — DELETE /v1/emulation/sessions/{id}.
function EmulationBanner() {
  const { identity } = useCabinetIdentity();
  const emulation = identity?.me.emulation;
  if (!emulation) return null;
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={`Режим эмуляции: вы действуете от имени «${identity.me.person.full_name}» (тестовая персона)`}
      description={`Все действия журналируются с реальным аккаунтом (${emulation.real_person_full_name}). Привилегированные действия в эмуляции недоступны.`}
      action={
        <Button
          danger
          size="small"
          onClick={async () => {
            await apiFetch(`/v1/emulation/sessions/${emulation.session_id}`, {
              method: "DELETE",
            });
            window.location.reload();
          }}
        >
          Завершить эмуляцию
        </Button>
      }
    />
  );
}

// Layout кабинета (VS-1): меню по ролям, баннер эмуляции, выход.
export function AppLayout() {
  const [narrow, setNarrow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { identity, roles, refreshIdentity } = useCabinetIdentity();
  usePageRefresh(refreshIdentity);
  const { mutate: logout } = useLogout();

  const manager = roles.some(role => ["chairman", "administrator", "deputy"].includes(role));
  const settings = [
    ...(manager ? [{ key: "/registry-import", label: "Импорт и экспорт" }] : []),
    ...(manager && !identity?.me.emulation ? [{ key: "/settings/requests", label: "Настройки обращений" }] : []),
    ...(canSeeTemplates(roles) ? [
      { key: "/time-rules", label: "Регламенты" },
      { key: "/templates", label: "Шаблоны сообщений" },
    ] : []),
    ...(canUseEmulation(roles) || identity?.me.emulation ? [{ key: "/emulation", label: "Эмуляция ролей (пилот)" }] : []),
  ];
  const items = [
    { key: "/", label: "Главная" },
    { key: "/requests", label: "Обращения" },
    ...(canSeeTasks(roles) ? [{ key: "tasks", label: "Задания", children: [
      { key: "/tasks", label: "Все задания" },
      ...(manager ? [
        { key: "/common-works", label: "Общие работы" },
        { key: "/job-templates", label: "Шаблоны заданий" },
      ] : []),
    ] }] : []),
    { key: "/incidents", label: "Аварии" },
    { key: "/publications", label: "Публикации" },
    { key: "/documents", label: "Документы" },
    { key: "/polls", label: "Опросы" },
    { key: "/initiatives", label: "Инициативы" },
    ...(manager ? [
      { key: "users", label: "Пользователи", children: [
        { key: "/users/residents", label: "Жители" },
        { key: "/users/staff", label: "Сотрудники" },
        { key: "/registrations", label: "Регистрации" },
        { key: "/invites", label: "Приглашения" },
      ] },
      { key: "registry", label: "Объекты эксплуатации", children: [
        { key: "/registry/buildings", label: "Здания" },
        { key: "/registry/premises", label: "Помещения" },
        { key: "/registry/connections", label: "Привязки помещений" },
        { key: "/registry/phases", label: "Очереди" },
      ] },
    ] : []),
    ...(!manager && roles.includes("tech_admin") ? [{ key: "/registrations", label: "Регистрации" }] : []),
    { key: "notifications", label: "Уведомления", children: [
      ...(manager ? [{ key: "/notifications/failures", label: "Ошибки доставки" }] : []),
      { key: "/notifications/preferences", label: "Мои настройки" },
    ] },
    ...(canSeeAudit(roles) ? [{ key: "/audit", label: "Журнал действий" }] : []),
    ...(settings.length ? [{ key: "settings", label: "Настройки", children: settings }] : []),
  ];
  const selectedPath = location.pathname;
  const activeGroup = items.find(item => item.children?.some(child => child.key === selectedPath))?.key;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" width={240} breakpoint="lg" collapsedWidth={0}
        collapsed={collapsed} onCollapse={setCollapsed} onBreakpoint={setNarrow}
        style={narrow ? { position: "fixed", zIndex: 1000, height: "100dvh" } : undefined}>
        <div style={{ color: "#fff", padding: "16px", fontWeight: 600 }}>
          ОСИ ЖК «Мунар Тау»
        </div>
        <div style={narrow ? { maxHeight: "calc(100dvh - 56px)", overflowY: "auto" } : undefined}>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedPath]}
          key={activeGroup}
          defaultOpenKeys={activeGroup ? [activeGroup] : []}
          items={items}
          onClick={({ key }) => { if (key === location.pathname) window.dispatchEvent(new Event(PAGE_REFRESH_EVENT));
            else navigate(key); if (narrow) setCollapsed(true); }}
        />
        </div>
      </Sider>
      <Layout style={{ minWidth: 0 }}>
        <Header style={{ background: "#fff", paddingInline: 16, minHeight: 64, height: "auto", gap: 12, flexWrap: "wrap", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography.Title level={4} style={{ margin: 0, lineHeight: "32px", fontSize: 18 }}>
            Кабинет администратора
          </Typography.Title>
          <Space wrap style={{ maxWidth: "100%" }}>
            <Typography.Text type="secondary">
              {identity?.fullName ?? "…"}
            </Typography.Text>
            {identity?.me.emulation && <EmulationRoleSelect
              key={identity.me.profile.id} profileId={identity.me.profile.id}
              onSwitched={refreshIdentity} />}
            <Button size="small" onClick={() => logout()}>
              Выйти
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 24 }}>
          <EmulationBanner />
          <Outlet key={location.pathname === "/emulation" ? "emulation" : identity?.me.profile.id} />
        </Content>
      </Layout>
    </Layout>
  );
}
