import { useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, Descriptions, Empty, List, Modal, Select, Skeleton, Space, Tag, Typography, theme } from "antd";
import { SettingOutlined, HolderOutlined, ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { PageLayout } from "../components/page-layout";
import { useDashboardIdentity, useDashboardResource, parseDashboardPreferences, moveWidget, type DashboardPreferences, type DashboardResponse } from "../lib/dashboard";
import { AssistantPanel } from "../assistant/assistant-panel";
import { DashboardChart, DashboardIncidentsChart, DashboardQualityChart, DashboardRegistrationsChart, DashboardTasksChart, DashboardTasksWorkload } from "./home-charts";
import { formatDateTime } from "../lib/format-date";
import "./home.css";

const states: Record<string, string> = { new: "Новое", reviewing: "На рассмотрении", need_clarification: "Нужно уточнение", in_work: "В работе", on_hold: "Отложено", awaiting_confirmation: "Ожидает подтверждения", rework: "На доработке", pending_review: "На проверке", disputed: "Оспаривается", created: "Ожидает назначения", awaiting_acceptance: "Ожидает принятия", on_review: "На проверке", signal_check: "Проверка сигнала", confirmed: "Подтверждена", mitigation: "Устранение", recovery_check: "Проверка устранения" };

export function HomePage() {
  const { identity, key } = useDashboardIdentity();
  if (!identity) return <Skeleton active />;
  return <Dashboard key={key} storageKey={`dashboard:v1:${identity.me.profile.id}:${identity.me.person.id}:${identity.me.person.is_test}`} />;
}
function Dashboard({ storageKey }: { storageKey: string }) {
  const { token } = theme.useToken();
  const { identity } = useDashboardIdentity();
  const session = identity?.me.session;
  const result = useDashboardResource<DashboardResponse>("/v1/dashboard");
  const [preferences, setPreferences] = useState(() => {
    try { return parseDashboardPreferences(localStorage.getItem(storageKey)); } catch { return parseDashboardPreferences(null); }
  });
  const [settings, setSettings] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  function save(next: DashboardPreferences) {
    setPreferences(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  const widgets = result.data?.widgets ?? [];
  const available = [...widgets.map(w => ({ id: w.id, title: w.title })),
    ...(result.data?.analytics ? [
      { id: "flow", title: "Динамика обращений" }, { id: "kinds", title: "Виды обращений" },
      { id: "lead", title: "Длительность обращений" }, { id: "overdue", title: "Просрочки" }, { id: "rating", title: "Оценки жителей" },
      { id: "task-flow", title: "Динамика заданий" }, { id: "task-states", title: "Состояния заданий" }, { id: "task-load", title: "Нагрузка исполнителей" },
      { id: "incident-flow", title: "Динамика аварий" },
      ...(result.data?.registration_analytics ? [{ id: "registrations-flow", title: "Регистрации жителей" }] : []),
    ] : [])];
  const visible = preferences.order.filter(id => available.some(w => w.id === id) && !preferences.hidden.includes(id));
  function move(id: string, target: string) {
    save({ ...preferences, order: moveWidget(preferences.order, id, target) });
    setAnnouncement(`Виджет «${available.find(w => w.id === id)?.title}» перемещён`);
  }
  return <PageLayout title="Главная" extra={<Button icon={<SettingOutlined />} aria-label="Настроить виджеты" onClick={() => setSettings(true)} disabled={!result.data} />}>
    {result.error && <Alert type="error" showIcon message="Не удалось загрузить главную" description={result.error} action={<Button onClick={() => void result.reload()}>Повторить</Button>} />}
    {result.loading && <Skeleton active />}
    {storageError && <Alert type="warning" message="Настройки применены. Браузер не позволил сохранить их для следующего посещения." />}
    <AssistantPanel />
    <span className="home-sr-only" role="status">{announcement}</span>
    <div className="home-grid">
      {visible.map((id, index) => {
        const widget = widgets.find(w => w.id === id);
        const title = available.find(w => w.id === id)!.title;
        return <section key={id} className={`home-widget${dragged === id ? " home-widget--dragging" : ""}`} aria-label={title} data-widget-id={id}>
          <Card title={<Space wrap><span>{title}</span>{widget && <Badge count={widget.total} showZero overflowCount={99999} color={token.colorTextSecondary} />}</Space>}
            extra={<Space size={0}>
              <Button type="text" size="small" icon={<ArrowUpOutlined />} aria-label={`Переместить выше: ${title}`} disabled={index === 0} onClick={() => move(id, visible[index - 1]!)} />
              <Button type="text" size="small" icon={<ArrowDownOutlined />} aria-label={`Переместить ниже: ${title}`} disabled={index === visible.length - 1} onClick={() => move(id, visible[index + 1]!)} />
              <span className="home-drag" title="Перетащить виджет" aria-hidden="true"
                onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragged(id); }}
                onPointerUp={e => {
                  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId;
                  if (dragged && target && visible.includes(target)) move(dragged, target);
                  setDragged(null);
                }} onPointerCancel={() => setDragged(null)}><HolderOutlined /></span>
            </Space>}>
            {widget ? <>
              <List dataSource={widget.items.slice(0, preferences.limits[id] ?? 5)} locale={{ emptyText: "Нет записей, требующих внимания" }} renderItem={item => <List.Item key={item.id}>
                <div className="home-item"><Link to={item.href}>{item.label}</Link>
                  <Space wrap size="small"><Typography.Text type="secondary">{states[item.state] ?? item.state}</Typography.Text>{item.overdue && <Tag color="error">Просрочено</Tag>}</Space>
                  <Space wrap size="small">{[item.building, item.premises].filter(Boolean).map((place, i) => place!.href ? <Link key={i} to={place!.href!}>{place!.label}</Link> : <Typography.Text key={i} type="secondary">{place!.label}</Typography.Text>)}</Space>
                </div>
              </List.Item>} />
              <Link to={widget.href}>Открыть список ({widget.total}) →</Link>
            </> : id === "flow" || id === "kinds" ? <DashboardChart kind={id === "flow" ? "flow" : "kinds"} />
              : id === "task-flow" || id === "task-states" ? <DashboardTasksChart kind={id === "task-flow" ? "task-flow" : "task-states"} />
              : id === "lead" || id === "overdue" || id === "rating" ? <DashboardQualityChart kind={id as "lead" | "overdue" | "rating"} />
              : id === "task-load" ? <DashboardTasksWorkload />
              : id === "incident-flow" ? <DashboardIncidentsChart />
              : <DashboardRegistrationsChart />}
          </Card>
        </section>;
      })}
    </div>
    {result.data && visible.length === 0 && <Empty description={available.length ? "Все виджеты скрыты. Выберите их в настройках." : "Для ваших полномочий нет доступных виджетов."} />}
    {session && <details className="home-session"><summary>Сеанс</summary><Descriptions column={1} size="small" items={[
      { key: "started", label: "Начат", children: formatDateTime(session.started_at) },
      { key: "total", label: "Предел всего сеанса", children: `${Math.round(session.total_limit_seconds / 3600)} ч` },
      { key: "idle", label: "Бездействие до завершения", children: `${Math.round(session.idle_limit_seconds / 60)} мин` },
    ]} /></details>}
    <Modal title="Настройки главной" open={settings} onCancel={() => setSettings(false)} footer={<Button type="primary" onClick={() => setSettings(false)}>Готово</Button>}>
      <Typography.Paragraph type="secondary">Изменения сохраняются автоматически в этом браузере. Доступные виджеты определяются вашими полномочиями. Порядок можно менять перетаскиванием или стрелками.</Typography.Paragraph>
      <List dataSource={available} renderItem={w => <List.Item>
        <Checkbox checked={!preferences.hidden.includes(w.id)} onChange={e => save({ ...preferences, hidden: e.target.checked ? preferences.hidden.filter(id => id !== w.id) : [...preferences.hidden, w.id] })}>{w.title}</Checkbox>
        {widgets.some(x => x.id === w.id) && <Select aria-label={`Количество записей: ${w.title}`} value={preferences.limits[w.id] ?? 5} options={[3, 5, 10, 20].map(value => ({ value, label: `${value} ${value === 3 ? "записи" : "записей"}` }))} onChange={n => save({ ...preferences, limits: { ...preferences.limits, [w.id]: n } })} />}
      </List.Item>} />
    </Modal>
  </PageLayout>;
}
