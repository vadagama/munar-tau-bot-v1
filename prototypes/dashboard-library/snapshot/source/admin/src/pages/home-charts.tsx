import { useState } from "react";
import { Alert, Button, Empty, Segmented, Skeleton, Space, Typography, theme } from "antd";
import { Link } from "react-router-dom";
import { analyticsLink, useDashboardResource, type DashboardAnalytics, type DashboardPeriod } from "../lib/dashboard";
const kinds: Record<string, string> = { request: "Заявки", question: "Вопросы", complaint: "Жалобы", emergency: "Экстренные ситуации" };
export function DashboardChart({ kind }: { kind: "flow" | "kinds" }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const { data, error, loading, reload } = useDashboardResource<DashboardAnalytics>(`/v1/dashboard/analytics?period=${period}`);
  const { token } = theme.useToken();
  const max = Math.max(1, ...(data?.buckets.flatMap(b => [b.created, b.closed]) ?? []));
  return <Space direction="vertical" className="home-chart">
    <Segmented block aria-label="Период графика" value={period} options={[{ value: "day", label: "День" }, { value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }, { value: "year", label: "Год" }]} onChange={v => setPeriod(v as DashboardPeriod)} />
    <Typography.Text type="secondary">Текущий период · время Алматы. Нажмите на показатель, чтобы открыть обращения.</Typography.Text>
    {loading && <Skeleton active />}
    {error && <Alert type="error" message={error} action={<Button onClick={() => void reload()}>Повторить</Button>} />}
    {data && (kind === "flow" ? <>
      <Typography.Text>Создано / закрыто</Typography.Text>
      <div className="home-bars">{data.buckets.map(b => <div className="home-bucket" key={b.from}>
        <div className="home-bar-pair">{(["created", "closed"] as const).map(measure => <Link key={measure} className="home-bar-link" to={analyticsLink(period, b.from, b.to, measure)} aria-label={`${b.label}: ${measure === "created" ? "создано" : "закрыто"} ${b[measure]}`}>
          <span>{b[measure]}</span><span className="home-bar" style={{ height: `${Math.max(2, b[measure] / max * 120)}px`, background: measure === "created" ? token.colorPrimary : token.colorSuccess }} />
          <small>{measure === "created" ? "С" : "З"}</small>
        </Link>)}</div><span>{b.label}</span>
      </div>)}</div>
    </> : <div className="home-kinds">{data.kinds.map(row => <Link key={row.kind} to={analyticsLink(period, data.from, data.to, "created", row.kind)}>
      <span>{kinds[row.kind] ?? row.kind}</span><strong>{row.count}</strong>
      <span className="home-kind-bar" style={{ width: `${Math.max(1, row.count / Math.max(1, ...data.kinds.map(k => k.count)) * 100)}%`, background: token.colorPrimary }} />
    </Link>)}</div>)}
    {data && data.buckets.every(b => !b.created && !b.closed) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="За период нет обращений" />}
  </Space>;
}
