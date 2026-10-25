import { EmulationRoleSelect } from "./emulation-role-select";
import { PAGE_REFRESH_EVENT, usePageRefresh } from "../lib/use-page-refresh";
import { DayQueueProvider, useDayQueue } from "../lib/day-queue";
import { MenuOutlined, UserOutlined } from "@ant-design/icons";
import { useMobile } from "../lib/use-mobile";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Drawer, Dropdown, Layout, Menu, Space, Typography, theme } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLogout } from "@refinedev/core";

import {
  canSeeAudit,
  canSeeAssistantSettings,
  canSeeTasks,
  canSeeTemplates,
  canUseEmulation,
  useCabinetIdentity,
} from "../lib/identity";
import { apiFetch } from "../lib/api";
import { BrandLogo } from "../components/brand-logo";

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

// Бейдж пункта меню: тихий нейтральный счётчик, только когда есть работа.
export function MenuLabel({ label, count }: { label: string; count: number }) {
  const { token } = theme.useToken();
  if (count <= 0) return <>{label}</>;
  return (
    <Space size={6}>
      <span>{label}</span>
      <Badge count={count} overflowCount={99} color={token.colorTextSecondary} />
    </Space>
  );
}

// Layout кабинета: на узких экранах (<992px) меню становится оверлеем
// с гамбургером в шапке, затемнением и закрытием по тапу/Esc/переходу.
export function AppLayout() {
  const narrow = useMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { identity, roles, refreshIdentity } = useCabinetIdentity();
  usePageRefresh(refreshIdentity);
  const { mutate: logout } = useLogout();
  const queue = useDayQueue();

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!(narrow && menuOpen)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [narrow, menuOpen]);

  const manager = roles.some(role => ["chairman", "administrator", "deputy"].includes(role));
  const settings = [
    ...(manager ? [{ key: "/registry-import", label: "Импорт и экспорт" }] : []),
    ...(manager && !identity?.me.emulation ? [{ key: "/settings/requests", label: "Настройки обращений" }] : []),
    // ADR-021: настройки ассистента — вне эмуляции (privileged).
    ...(canSeeAssistantSettings(roles) && !identity?.me.emulation ? [{ key: "/settings/assistant", label: "AI-ассистент" }] : []),
    ...(canSeeTemplates(roles) ? [
      { key: "/time-rules", label: "Регламенты" },
      { key: "/templates", label: "Шаблоны сообщений" },
    ] : []),
    ...(canUseEmulation(roles) || identity?.me.emulation ? [{ key: "/emulation", label: "Эмуляция ролей (пилот)" }] : []),
  ];
  const items = [
    { key: "/", label: <MenuLabel label="Главная" count={0} /> },
    { key: "/requests", label: <MenuLabel label="Обращения" count={queue.requestsNew.length + queue.requestsAction.length} /> },
    ...(canSeeTasks(roles) ? [{ key: "tasks", label: <MenuLabel label="Задания" count={queue.tasksAccept.length + queue.tasksReview.length} />, children: [
      { key: "/tasks", label: "Все задания" },
      ...(manager ? [
        { key: "/common-works", label: "Общие работы" },
        { key: "/job-templates", label: "Шаблоны заданий" },
      ] : []),
    ] }] : []),
    { key: "/incidents", label: <MenuLabel label="Аварии" count={queue.incidentsAction.length} /> },
    { key: "/publications", label: "Публикации" },
    { key: "/documents", label: "Документы" },
    { key: "/polls", label: "Опросы" },
    { key: "/initiatives", label: "Инициативы" },
    ...(canSeeTasks(roles) ? [{key:"/reports",label:"Отчётность"}] : []),
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

  const navigation = <>
    <div style={{ padding: "16px 16px 12px" }}><BrandLogo size={24} caption="Кабинет ОСИ" /></div>
    <Menu theme="light" mode="inline" selectedKeys={[selectedPath]} key={activeGroup}
      defaultOpenKeys={activeGroup ? [activeGroup] : []} items={items}
      onClick={({ key }) => {
        if (key === location.pathname) window.dispatchEvent(new Event(PAGE_REFRESH_EVENT));
        else navigate(key);
        setMenuOpen(false);
      }} />
  </>;
  return (
    <DayQueueProvider>
    <Layout style={{ minHeight: "100vh" }}>
      {narrow ? <Drawer title="Меню кабинета" placement="left" width="min(320px, 100vw)"
        open={menuOpen} onClose={() => setMenuOpen(false)} styles={{ body: { padding: 0 } }}>
        {navigation}
      </Drawer> : <Sider theme="light" width={240} style={{ borderInlineEnd: "1px solid #eceef0" }}>{navigation}</Sider>}
      <Layout style={{ minWidth: 0 }}>
        <Header className="cabinet-header" style={{ background: "#fff", borderBottom: "1px solid #eceef0", paddingInline: 24, minHeight: 56, height: "auto", gap: 12, flexWrap: "wrap", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {narrow && <Button type="text" icon={<MenuOutlined />} aria-label="Открыть меню" onClick={() => setMenuOpen(true)} />}
          <Typography.Title level={4} style={{ margin: 0, lineHeight: "32px", fontSize: 18 }}>
            {narrow ? "Кабинет ОСИ" : "Кабинет администратора"}
          </Typography.Title>
          {narrow ? <Dropdown trigger={["click"]} menu={{ items: [
            { key: "name", label: identity?.fullName ?? "Профиль", disabled: true },
            { key: "logout", label: "Выйти", onClick: () => logout() },
          ] }}><Button type="text" icon={<UserOutlined />} aria-label="Профиль" /></Dropdown> : <Space wrap style={{ maxWidth: "100%" }}>
            <Typography.Text type="secondary">
              {identity?.fullName ?? "…"}
            </Typography.Text>
            {identity?.me.emulation && <EmulationRoleSelect
              key={identity.me.profile.id} profileId={identity.me.profile.id}
              onSwitched={refreshIdentity} />}
            <Button size="small" onClick={() => logout()}>
              Выйти
            </Button>
          </Space>}
        </Header>
        {narrow && identity?.me.emulation && <div className="mobile-emulation-switch"><EmulationRoleSelect key={identity.me.profile.id} profileId={identity.me.profile.id} onSwitched={refreshIdentity} /></div>}
        <Content className="cabinet-content" style={{ width: "100%", padding: "24px 24px 48px" }}>
          <EmulationBanner />
          <Outlet key={location.pathname === "/emulation" ? "emulation" : identity?.me.profile.id} />
        </Content>
      </Layout>
    </Layout>
    </DayQueueProvider>
  );
}
