import { Layout, Menu, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

// Пустой защищённый layout (VS-0): каркас навигации без данных.
// Реальная защита маршрутов (PDP на сервере, AUTH-01) — со среза VS-1;
// разделы обращений/заданий — с VS-2.
export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" width={240}>
        <div style={{ color: "#fff", padding: "16px", fontWeight: 600 }}>
          Мунар Тау — ОСИ
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={[
            {
              key: "/",
              label: "Главная",
              disabled: false,
              onClick: () => navigate("/"),
            },
            {
              key: "vs2-placeholder",
              label: "Разделы появятся с VS-2",
              disabled: true,
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", paddingInline: 24 }}>
          <Typography.Title level={4} style={{ margin: 0, lineHeight: "64px" }}>
            Кабинет администратора ОСИ
          </Typography.Title>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
