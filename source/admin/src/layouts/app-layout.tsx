import { Alert, Button, Layout, Menu, Space, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLogout } from "@refinedev/core";

import {
  canSeeAudit,
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
  const navigate = useNavigate();
  const location = useLocation();
  const { identity, roles } = useCabinetIdentity();
  const { mutate: logout } = useLogout();

  const items = [
    { key: "/", label: "Главная" },
    { key: "/requests", label: "Обращения" },
    ...(canSeeAudit(roles) ? [{ key: "/audit", label: "Журнал действий" }] : []),
    ...(roles.some(role=>["chairman","administrator","tech_admin"].includes(role)) ? [{key:"/time-rules",label:"Регламенты регистрации"}] : []),
    ...(canUseEmulation(roles) || identity?.me.emulation ? [{ key: "/emulation", label: "Эмуляция" }] : []),
    ...(["chairman","administrator","deputy"].some(role=>roles.includes(role as typeof roles[number])) ? [{key:"/registry",label:"Реестр"},{key:"/registrations",label:"Регистрация и споры"},{key:"/invites",label:"Приглашения"},{key:"/registry-import",label:"Импорт и экспорт"}] : []),
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" width={240} breakpoint="lg" collapsedWidth={0}>
        <div style={{ color: "#fff", padding: "16px", fontWeight: 600 }}>
          Мунар Тау — ОСИ
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items.map((item) => ({ ...item, onClick: () => navigate(item.key) }))}
        />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", paddingInline: 16, minHeight: 64, height: "auto", gap: 12, flexWrap: "wrap", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography.Title level={4} style={{ margin: 0, lineHeight: "32px", fontSize: 18 }}>
            Кабинет администратора ОСИ
          </Typography.Title>
          <Space>
            <Typography.Text type="secondary">
              {identity?.fullName ?? "…"}
            </Typography.Text>
            <Button size="small" onClick={() => logout()}>
              Выйти
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 24 }}>
          <EmulationBanner />
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
