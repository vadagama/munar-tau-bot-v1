import { useState } from "react";
import {
  Alert, Button, Card, Col, ConfigProvider, Input, Layout, Menu, Popconfirm, Row, Segmented,
  Select, Space, Switch, Table, Tag, Typography, theme,
} from "antd";
import ruRU from "antd/locale/ru_RU";

import { BrandLogo } from "../components/brand-logo";
import { PageLayout } from "../components/page-layout";
import { ProcessOverview } from "../components/process-card";
import { MenuLabel } from "../layouts/app-layout";
import { QueueBlock } from "./home";
import { cabinetTheme, type CabinetVariant } from "../lib/cabinet-theme";
import type { QueueRow } from "../lib/day-queue";

const { Header, Sider, Content } = Layout;

// Превью темы кабинета (только DEV, вне Authenticated): одна композиция из
// реальных компонентов в двух вариантах палитры — для выбора направления.
// В продакшен не попадает: маршрут гейтится import.meta.env.DEV в App.tsx.

const MENU_ITEMS = [
  { key: "/", label: "Главная" },
  { key: "/requests", label: <MenuLabel label="Обращения" count={7} /> },
  { key: "tasks", label: <MenuLabel label="Задания" count={3} />, children: [
    { key: "/tasks", label: "Все задания" },
    { key: "/common-works", label: "Общие работы" },
    { key: "/job-templates", label: "Шаблоны заданий" },
  ] },
  { key: "/incidents", label: <MenuLabel label="Аварии" count={2} /> },
  { key: "/publications", label: "Публикации" },
  { key: "users", label: "Пользователи", children: [
    { key: "/users/residents", label: "Жители" },
    { key: "/users/staff", label: "Сотрудники" },
  ] },
  { key: "registry", label: "Объекты эксплуатации", children: [
    { key: "/registry/buildings", label: "Здания" },
    { key: "/registry/premises", label: "Помещения" },
    { key: "/registry/phases", label: "Очереди" },
  ] },
  { key: "notifications", label: "Уведомления", children: [
    { key: "/notifications/failures", label: "Ошибки доставки" },
    { key: "/notifications/preferences", label: "Мои настройки" },
  ] },
  { key: "/audit", label: "Журнал действий" },
  { key: "settings", label: "Настройки", children: [
    { key: "/registry-import", label: "Импорт и экспорт" },
    { key: "/settings/requests", label: "Настройки обращений" },
  ] },
];

const STATUS_PILLS: Record<string, { bg: string; fg: string }> = {
  "Новая": { bg: "#eef0f2", fg: "#57606a" },
  "На рассмотрении": { bg: "#e8edf6", fg: "#275089" },
  "В работе": { bg: "#e6f2ec", fg: "#1a6b45" },
  "Ожидает жильца": { bg: "#faf1e2", fg: "#8a5a10" },
  "Закрыта": { bg: "#f2f3f4", fg: "#57606a" },
};

function StatusPill({ label }: { label: string }) {
  const pill = STATUS_PILLS[label];
  const colors = pill ?? { bg: "#eef0f2", fg: "#57606a" };
  return <Tag style={{ background: colors.bg, color: colors.fg, borderColor: "transparent" }}>{label}</Tag>;
}

const ROWS = [
  { key: "1", number: 1042, topic: "Не работает домофон в подъезде 2", building: "Корпус 1", state: "В работе", due: "24.10, 18:00", owner: "Ахметова Д." },
  { key: "2", number: 1041, topic: "Протекает кровля над паркингом", building: "Корпус 1", state: "На рассмотрении", due: "25.10, 12:00", owner: "Ержанов С." },
  { key: "3", number: 1039, topic: "Перегорели лампы во дворе", building: "Корпус 2", state: "Новая", due: "—", owner: "— " },
  { key: "4", number: 1036, topic: "Шум ремонтных работ ночью", building: "Корпус 2", state: "Ожидает жильца", due: "23.10, 10:00", owner: "Иманбаев А." },
  { key: "5", number: 1031, topic: "Не открывается шлагбаум", building: "Корпус 1", state: "Закрыта", due: "21.10, 16:30", owner: "Садвакасова М." },
];

const COLUMNS = [
  { title: "№", dataIndex: "number", width: 72 },
  { title: "Тема", dataIndex: "topic" },
  { title: "Здание", dataIndex: "building", width: 120 },
  { title: "Статус", dataIndex: "state", width: 150, render: (label: string) => <StatusPill label={label} /> },
  { title: "Срок", dataIndex: "due", width: 120 },
  { title: "Исполнитель", dataIndex: "owner", width: 140 },
];

// Демо-строки для секции «Очередь дня»: реальные компоненты home с теми же
// токенами — счётчик Badge и рамка просрочки видны без авторизации.
const DEMO_REQUEST_ROWS: QueueRow[] = [
  { id: "demo-r1", number: 1042, state: "new", building_name: "Корпус 1" },
  { id: "demo-r2", number: 1041, state: "new", building_name: "Корпус 2" },
];
const DEMO_TASK_ROWS: QueueRow[] = [
  { id: "demo-t1", state: "to_accept", title: "Принять задание: домофон в подъезде" },
  { id: "demo-t2", state: "to_accept", title: "Принять задание: кровля над паркингом" },
];

const VARIANT_LABELS: Record<CabinetVariant, string> = {
  green: "A — Зелёный",
  neutral: "B — Нейтральный",
};

export function ThemePreviewPage() {
  // Стартовый вариант можно задать параметром ?variant=neutral (для скриншотов);
  // в живой сессии вариант переключается сегментом на экране.
  const [variant, setVariant] = useState<CabinetVariant>(() =>
    new URLSearchParams(window.location.search).get("variant") === "green" ? "green" : "neutral");
  // Респонсив-логика как в AppLayout: на узких экранах сайдбар скрывается.
  const [narrow, setNarrow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();

  return (
    <div style={{ minHeight: "100vh", background: "#f6f7f8" }}>
      <div style={{
        position: "fixed", top: 12, right: 16, zIndex: 2000,
        display: "flex", alignItems: "center", gap: 8,
        background: "#ffffff", border: "1px solid #d9dce0", borderRadius: 10,
        padding: "6px 8px", boxShadow: "0 4px 12px rgba(16, 24, 40, 0.10)",
      }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Вариант темы:</Typography.Text>
        <Segmented
          value={variant}
          onChange={(value) => setVariant(value as CabinetVariant)}
          options={(Object.keys(VARIANT_LABELS) as CabinetVariant[]).map(key => ({
            label: VARIANT_LABELS[key], value: key,
          }))}
        />
      </div>
      <ConfigProvider locale={ruRU} theme={cabinetTheme(variant)}>
        <Layout style={{ minHeight: "100vh" }}>
          <Sider theme="light" width={240} breakpoint="lg" collapsedWidth={0}
            collapsed={collapsed} onCollapse={setCollapsed} onBreakpoint={setNarrow}
            style={{ borderInlineEnd: "1px solid #eceef0",
              ...(narrow ? { position: "fixed", zIndex: 1000, height: "100dvh" } : null) }}>
            <div style={{ padding: "16px 16px 12px" }}>
              <BrandLogo size={24} caption="Кабинет ОСИ" />
            </div>
            <Menu
              theme="light"
              mode="inline"
              defaultSelectedKeys={["/requests"]}
              defaultOpenKeys={["tasks", "users", "registry", "settings"]}
              items={MENU_ITEMS}
              onClick={() => undefined}
            />
          </Sider>
          <Layout style={{ minWidth: 0 }}>
            <Header style={{
              borderBottom: "1px solid #eceef0", paddingInline: 24, display: "flex",
              justifyContent: "space-between", alignItems: "center", gap: 12,
            }}>
              <Typography.Text strong style={{ fontSize: 15 }}>Обращения</Typography.Text>
              <Space size={12}>
                <Typography.Text type="secondary">Айгуль Сапарова · председатель</Typography.Text>
                <Button size="small">Выйти</Button>
              </Space>
            </Header>
            <Content style={{ margin: 24 }}>
              <PageLayout
                title="Обращения"
                actions={<Space wrap>
                  <Button type="primary">Новое обращение</Button>
                  <Button>Экспорт</Button>
                </Space>}
                filters={<Space wrap>
                  <Input.Search placeholder="Номер, описание или инициатор" style={{ width: 280 }} />
                  <Select
                    defaultValue="all"
                    style={{ width: 180 }}
                    options={[
                      { value: "all", label: "Все здания" },
                      { value: "b1", label: "Корпус 1" },
                      { value: "b2", label: "Корпус 2" },
                    ]}
                  />
                  <Select
                    defaultValue="all"
                    style={{ width: 180 }}
                    options={[
                      { value: "all", label: "Все статусы" },
                      { value: "new", label: "Новые" },
                      { value: "work", label: "В работе" },
                    ]}
                  />
                </Space>}
              >
                <ProcessOverview
                  guidance={{
                    title: "Обращение в работе",
                    description: "Ожидаем выполнения работ и итогового ответа ОСИ. Проверьте связанные задания и материалы.",
                    waitingFor: "Исполнители связанных заданий",
                  }}
                  state="В работе"
                  due="2026-10-24T18:00:00+06:00"
                  participant="Ержанов С."
                />
                <Table
                  columns={COLUMNS}
                  dataSource={ROWS}
                  rowKey="key"
                  pagination={{ pageSize: 5, showSizeChanger: false }}
                  size="middle"
                />
                <Alert
                  type="info"
                  showIcon
                  message="Информационное сообщение"
                  description="Пример системной подсказки: доставка уведомления не означает прочтения."
                  style={{ marginTop: 24 }}
                  action={<Button size="small" type="text">Понятно</Button>}
                />
                <div style={{
                  marginTop: 24, background: "#ffffff", border: "1px solid #eceef0",
                  borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 16,
                }}>
                  <Typography.Text strong>Элементы управления</Typography.Text>
                  <Space wrap>
                    <Button type="primary">Основная</Button>
                    <Button>Обычная</Button>
                    <Button type="dashed">Пунктирная</Button>
                    <Button type="text">Текстовая</Button>
                    <Button type="link">Ссылка</Button>
                    <Popconfirm title="Удалить запись?" okText="Удалить" cancelText="Отмена">
                      <Button danger>Опасная</Button>
                    </Popconfirm>
                  </Space>
                  <Space wrap>
                    <Input placeholder="Текстовое поле" style={{ width: 220 }} />
                    <Select
                      defaultValue="a"
                      style={{ width: 160 }}
                      options={[{ value: "a", label: "Выбор из списка" }]}
                    />
                    <Switch defaultChecked />
                    <Typography.Text>Переключатель</Typography.Text>
                  </Space>
                  <Space wrap size={4}>
                    <Tag>По умолчанию</Tag>
                    <StatusPill label="В работе" />
                    <StatusPill label="Ожидает жильца" />
                    <Tag color="error">Ошибка</Tag>
                    <Tag color="success">Успех</Tag>
                  </Space>
                </div>
                <div style={{
                  marginTop: 24, background: "#ffffff", border: "1px solid #eceef0",
                  borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 16,
                }}>
                  <Typography.Text strong>Очередь дня (демо)</Typography.Text>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <QueueBlock
                        title="Обращения: новые"
                        count={5}
                        to="#"
                        rows={DEMO_REQUEST_ROWS}
                        label={(row) => `З-${String(row.number ?? 0)} · Пример обращения`}
                        secondary={(row) => typeof row.building_name === "string" ? row.building_name : undefined}
                      />
                    </Col>
                    <Col xs={24} lg={12}>
                      <QueueBlock
                        title="Задания: принятие и проверка"
                        count={3}
                        to="#"
                        rows={DEMO_TASK_ROWS}
                        label={(row) => typeof row.title === "string" ? row.title : "Пример задания"}
                        secondary={() => "Ожидает принятия"}
                      />
                    </Col>
                  </Row>
                  <Card style={{ borderColor: token.colorErrorBorder }}>
                    <Typography.Text type="danger">
                      Просрочено обращений: 2 — проверьте разделы «Обращения» и «Задания» (демо).
                    </Typography.Text>
                  </Card>
                </div>
              </PageLayout>
            </Content>
          </Layout>
        </Layout>
      </ConfigProvider>
    </div>
  );
}
