import { useState, type ReactNode } from "react";
import { Alert, Button, Empty, Segmented, Skeleton, Space, Typography, theme } from "antd";
import { Link } from "react-router-dom";
import {
  analyticsLink, useDashboardResource, type DashboardAnalytics, type DashboardIncidentsAnalytics,
  type DashboardPeriod, type DashboardQualityAnalytics, type DashboardRegistrationsAnalytics,
  type DashboardTasksAnalytics, type DashboardTasksWorkload,
} from "../lib/dashboard";
import { TASK_STATE_TEXT } from "../../../core/src/locales/tasks";
const kinds: Record<string, string> = { request: "Заявки", question: "Вопросы", complaint: "Жалобы", emergency: "Экстренные ситуации" };
const periodOptions = [{ value: "day", label: "День" }, { value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }, { value: "year", label: "Год" }];
/** Даты детализации на странице заданий — календарные дни по времени Алматы. */
const almatyDate = (iso: string, offsetMs = 0) => new Date(Date.parse(iso) + 5 * 3600_000 + offsetMs).toISOString().slice(0, 10);
const hint = (noun: string) => `Текущий период · время Алматы. Нажмите на показатель, чтобы открыть ${noun}.`;
const formatHours = (value: number | null) => value == null ? "—"
  : value >= 48 ? `${(value / 24).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} д`
  : `${Math.round(value).toLocaleString("ru-RU")} ч`;
const formatScore = (value: number | null) => value == null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
function PeriodChart({ hint, period, setPeriod, loading, error, reload, empty, emptyText, children }: {
  hint: string; period: DashboardPeriod; setPeriod: (value: DashboardPeriod) => void;
  loading: boolean; error?: string; reload: () => void; empty: boolean; emptyText: string; children?: ReactNode;
}) {
  return <Space direction="vertical" className="home-chart">
    <Segmented block aria-label="Период графика" value={period} options={periodOptions} onChange={v => setPeriod(v as DashboardPeriod)} />
    <Typography.Text type="secondary">{hint}</Typography.Text>
    {loading && <Skeleton active />}
    {error && <Alert type="error" message={error} action={<Button onClick={() => void reload()}>Повторить</Button>} />}
    {children}
    {empty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />}
  </Space>;
}
type FlowBucket = { label: string; from: string; to: string };
function FlowBars<T extends FlowBucket>({ buckets, series }: {
  buckets: T[]; series: Array<{ key: keyof T & string; letter: string; color: string; title: string; href: (bucket: T) => string }>;
}) {
  const max = Math.max(1, ...buckets.flatMap(b => series.map(s => Number(b[s.key]) || 0)));
  return <div className="home-bars">{buckets.map(b => <div className="home-bucket" key={b.from}>
    <div className="home-bar-pair">{series.map(s => {
      const value = Number(b[s.key]) || 0;
      return <Link key={s.key} className="home-bar-link" to={s.href(b)} aria-label={`${b.label}: ${s.title} ${value}`}>
        <span>{value}</span><span className="home-bar" style={{ height: `${Math.max(2, value / max * 120)}px`, background: s.color }} />
        <small>{s.letter}</small>
      </Link>;
    })}</div><span>{b.label}</span>
  </div>)}</div>;
}
function MetricBars<T extends FlowBucket>({ buckets, read, format, href, aria, scale }: {
  buckets: T[]; read: (bucket: T) => number | null; format: (value: number | null) => string;
  href: (bucket: T) => string; aria: (bucket: T, text: string) => string; scale?: number;
}) {
  const { token } = theme.useToken();
  const top = scale ?? Math.max(1, ...buckets.map(b => read(b) ?? 0));
  return <div className="home-bars">{buckets.map(b => {
    const value = read(b);
    return <div className="home-bucket" key={b.from}>
      <Link className="home-bar-link" to={href(b)} aria-label={aria(b, format(value))}>
        <span>{format(value)}</span>
        <span className="home-bar" style={{ height: `${Math.max(2, (value ?? 0) / top * 120)}px`, background: token.colorPrimary }} />
      </Link>
      <span>{b.label}</span>
    </div>;
  })}</div>;
}
export function DashboardChart({ kind }: { kind: "flow" | "kinds" }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const { data, error, loading, reload } = useDashboardResource<DashboardAnalytics>(`/v1/dashboard/analytics?period=${period}`);
  const { token } = theme.useToken();
  return <PeriodChart hint={hint("обращений")} period={period} setPeriod={setPeriod} loading={loading} error={error} reload={reload}
    empty={!!data && data.buckets.every(b => !b.created && !b.closed)} emptyText="За период нет обращений">
    {data && (kind === "flow" ? <>
      <Typography.Text>Создано / закрыто</Typography.Text>
      <FlowBars buckets={data.buckets} series={[
        { key: "created", letter: "С", color: token.colorPrimary, title: "создано", href: b => analyticsLink(period, b.from, b.to, "created") },
        { key: "closed", letter: "З", color: token.colorSuccess, title: "закрыто", href: b => analyticsLink(period, b.from, b.to, "closed") },
      ]} />
    </> : <div className="home-kinds">{data.kinds.map(row => <Link key={row.kind} to={analyticsLink(period, data.from, data.to, "created", row.kind)}>
      <span>{kinds[row.kind] ?? row.kind}</span><strong>{row.count}</strong>
      <span className="home-kind-bar" style={{ width: `${Math.max(1, row.count / Math.max(1, ...data.kinds.map(k => k.count)) * 100)}%`, background: token.colorPrimary }} />
    </Link>)}</div>)}
  </PeriodChart>;
}
export function DashboardTasksChart({ kind }: { kind: "task-flow" | "task-states" }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const { data, error, loading, reload } = useDashboardResource<DashboardTasksAnalytics>(`/v1/dashboard/tasks-analytics?period=${period}`);
  const { token } = theme.useToken();
  return <PeriodChart hint={hint("задания")} period={period} setPeriod={setPeriod} loading={loading} error={error} reload={reload}
    empty={!!data && data.buckets.every(b => !b.created && !b.accepted)} emptyText="За период нет заданий">
    {data && (kind === "task-flow" ? <>
      <Typography.Text>Создано / принято</Typography.Text>
      <FlowBars buckets={data.buckets} series={[
        { key: "created", letter: "С", color: token.colorPrimary, title: "создано", href: b => `/tasks?from=${almatyDate(b.from)}&to=${almatyDate(b.to, -1)}` },
        { key: "accepted", letter: "П", color: token.colorSuccess, title: "принято", href: () => "/tasks?state=accepted_admin" },
      ]} />
    </> : <div className="home-kinds">{data.states.map(row => <Link key={row.state} to={`/tasks?state=${row.state}`}>
      <span>{TASK_STATE_TEXT[row.state]?.ru ?? row.state}</span><strong>{row.count}</strong>
      <span className="home-kind-bar" style={{ width: `${Math.max(1, row.count / Math.max(1, ...data.states.map(s => s.count)) * 100)}%`, background: token.colorPrimary }} />
    </Link>)}</div>)}
  </PeriodChart>;
}
export function DashboardQualityChart({ kind }: { kind: "lead" | "overdue" | "rating" }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const { data, error, loading, reload } = useDashboardResource<DashboardQualityAnalytics>(`/v1/dashboard/quality-analytics?period=${period}`);
  const { token } = theme.useToken();
  const buckets = data?.buckets ?? [];
  const empty = kind === "lead" ? buckets.every(b => b.median_hours == null)
    : kind === "overdue" ? buckets.every(b => !b.requests_late && !b.accepted_late)
    : buckets.every(b => !b.rated);
  const emptyText = kind === "lead" ? "За период нет закрытых обращений" : kind === "overdue" ? "За период нет просрочек" : "За период нет оценок";
  return <PeriodChart hint={hint(kind === "overdue" ? "обращения или задания" : "закрытые обращения")} period={period} setPeriod={setPeriod}
    loading={loading} error={error} reload={reload} empty={empty} emptyText={emptyText}>
    {data && (kind === "lead" ? <>
      <Typography.Text>Медиана от создания до закрытия</Typography.Text>
      <MetricBars buckets={buckets} read={b => b.median_hours} format={formatHours}
        href={b => analyticsLink(period, b.from, b.to, "closed")} aria={(b, text) => `${b.label}: медиана ${text}`} />
    </> : kind === "overdue" ? <>
      <Typography.Text>Обращения / задания</Typography.Text>
      <FlowBars buckets={buckets} series={[
        { key: "requests_late", letter: "О", color: token.colorPrimary, title: "обращения с опозданием", href: b => analyticsLink(period, b.from, b.to, "closed") },
        { key: "accepted_late", letter: "З", color: token.colorSuccess, title: "задания с опозданием", href: () => "/tasks?state=accepted_admin" },
      ]} />
    </> : <>
      <Typography.Text>Средняя оценка (1–5)</Typography.Text>
      <MetricBars buckets={buckets} read={b => b.avg_rating} format={formatScore} scale={5}
        href={b => analyticsLink(period, b.from, b.to, "closed")} aria={(b, text) => `${b.label}: средняя оценка ${text} (оценок: ${b.rated})`} />
    </>)}
  </PeriodChart>;
}
export function DashboardTasksWorkload() {
  const { data, error, loading, reload } = useDashboardResource<DashboardTasksWorkload>("/v1/dashboard/tasks-workload");
  const { token } = theme.useToken();
  const rows = data?.workload ?? [];
  const max = Math.max(1, ...rows.map(r => r.open));
  return <Space direction="vertical" className="home-chart">
    {loading && <Skeleton active />}
    {error && <Alert type="error" message={error} action={<Button onClick={() => void reload()}>Повторить</Button>} />}
    {data && (rows.length ? <div className="home-kinds">{rows.map(row => <Link key={row.person_id ?? "unassigned"} to={row.person_id ? `/tasks?assignee=${row.person_id}` : "/tasks?assignee=unassigned"}>
      <span>{row.name}</span><strong>{row.open}</strong>
      <span className="home-kind-bar" style={{ width: `${Math.max(1, row.open / max * 100)}%`, background: token.colorPrimary }} />
      {row.overdue > 0 && <Typography.Text type="danger">Просрочено: {row.overdue}</Typography.Text>}
    </Link>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Открытых заданий нет" />)}
  </Space>;
}
export function DashboardIncidentsChart() {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const { data, error, loading, reload } = useDashboardResource<DashboardIncidentsAnalytics>(`/v1/dashboard/incidents-analytics?period=${period}`);
  const { token } = theme.useToken();
  return <PeriodChart hint={hint("аварии")} period={period} setPeriod={setPeriod} loading={loading} error={error} reload={reload}
    empty={!!data && data.buckets.every(b => !b.created && !b.completed)} emptyText="За период нет аварий">
    {data && <>
      <Typography.Text>Создано / завершено</Typography.Text>
      <FlowBars buckets={data.buckets} series={[
        { key: "created", letter: "С", color: token.colorPrimary, title: "создано", href: () => "/incidents" },
        { key: "completed", letter: "З", color: token.colorSuccess, title: "завершено", href: () => "/incidents" },
      ]} />
    </>}
  </PeriodChart>;
}
export function DashboardRegistrationsChart() {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const { data, error, loading, reload } = useDashboardResource<DashboardRegistrationsAnalytics>(`/v1/dashboard/registrations-analytics?period=${period}`);
  const { token } = theme.useToken();
  return <PeriodChart hint={hint("регистрации")} period={period} setPeriod={setPeriod} loading={loading} error={error} reload={reload}
    empty={!!data && data.buckets.every(b => !b.primary && !b.binding)} emptyText="За период нет регистраций">
    {data && <>
      <Typography.Text>Анкеты / привязки</Typography.Text>
      <FlowBars buckets={data.buckets} series={[
        { key: "primary", letter: "Р", color: token.colorPrimary, title: "анкеты", href: () => "/registrations?kind=primary" },
        { key: "binding", letter: "П", color: token.colorSuccess, title: "привязки", href: () => "/registrations?kind=binding" },
      ]} />
    </>}
  </PeriodChart>;
}
