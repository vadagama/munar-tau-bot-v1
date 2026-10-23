import { PageLayout } from "../components/page-layout";
import { Badge, Card, Col, Descriptions, List, Row as GridRow, Spin, Typography, theme } from "antd";
import { Link } from "react-router-dom";

import { useCabinetIdentity } from "../lib/identity";
import { useDayQueue, type QueueRow } from "../lib/day-queue";
import { formatDateTime } from "../lib/format-date";

// Главная (Operate): очередь дня — новые обращения, обращения «нужно ваше
// действие», задания к принятию/проверке, просрочки и аварии; каждый блок
// ведёт в соответствующий список. Пределы сеанса (AUTH-06) — ниже.

const REQUEST_STATE_LINK: Record<string, string> = {
  new: "Новая",
  need_clarification: "Нужно уточнение",
  awaiting_confirmation: "Ожидает подтверждения",
};

function requestLabel(row: QueueRow): string {
  const number = row.number ? `№${row.number}` : "";
  const text = typeof row.description === "string" ? row.description.slice(0, 80) : "";
  return [number, text].filter(Boolean).join(" · ");
}

function taskLabel(row: QueueRow): string {
  const text = typeof row.description === "string" ? row.description.slice(0, 80) : "";
  return text || "Задание";
}

function incidentLabel(row: QueueRow): string {
  const text = typeof row.title === "string" ? row.title.slice(0, 80) : "";
  return text || "Авария";
}

// Блок очереди: заголовок со счётчиком, до 4 строк, ссылка «Все …».
export function QueueBlock({ title, count, to, rows, label, secondary }: {
  title: string;
  count: number;
  to: string;
  rows: QueueRow[];
  label: (row: QueueRow) => string;
  secondary?: (row: QueueRow) => string | undefined;
}) {
  const { token } = theme.useToken();
  return (
    <Card
      title={title}
      extra={<Badge count={count} overflowCount={99} color={token.colorTextSecondary} />}
      styles={{ body: { paddingBlock: 8 } }}
    >
      {count > 0 ? (
        <List
          size="small"
          dataSource={rows.slice(0, 4)}
          renderItem={(row) => (
            <List.Item>
              <List.Item.Meta
                title={label(row)}
                description={secondary?.(row)}
              />
            </List.Item>
          )}
        />
      ) : (
        <Typography.Text type="secondary">Пусто</Typography.Text>
      )}
      <Typography.Link>
        <Link to={to}>Открыть список →</Link>
      </Typography.Link>
    </Card>
  );
}

export function HomePage() {
  const { identity, isLoading } = useCabinetIdentity();
  const queue = useDayQueue();
  const { token } = theme.useToken();

  if (isLoading || !identity) {
    return <Spin size="large" style={{ display: "block", margin: "80px auto" }} />;
  }

  const { me } = identity;
  const tasksAction = queue.tasksAccept.length + queue.tasksReview.length;

  return (
    <PageLayout title="Очередь дня">
      {queue.error && (
        <Typography.Text type="danger" style={{ display: "block", marginBlockEnd: 16 }}>
          {queue.error}
        </Typography.Text>
      )}
      <GridRow gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <QueueBlock
            title="Обращения: новые"
            count={queue.requestsNew.length}
            to="/requests?state=new"
            rows={queue.requestsNew}
            label={requestLabel}
            secondary={(row) => typeof row.building_name === "string" ? row.building_name : undefined}
          />
        </Col>
        <Col xs={24} lg={12}>
          <QueueBlock
            title="Обращения: нужно ваше действие"
            count={queue.requestsAction.length}
            to="/requests"
            rows={queue.requestsAction}
            label={requestLabel}
            secondary={(row) => [REQUEST_STATE_LINK[row.state],
              typeof row.author_name === "string" ? `Автор: ${row.author_name}` : undefined]
              .filter(Boolean).join(" · ") || undefined}
          />
        </Col>
        <Col xs={24} lg={12}>
          <QueueBlock
            title="Задания: принятие и проверка"
            count={tasksAction}
            to="/tasks"
            rows={[...queue.tasksAccept, ...queue.tasksReview]}
            label={taskLabel}
            secondary={(row) => row.state === "on_review" ? "На проверке" : "Ожидает принятия"}
          />
        </Col>
        <Col xs={24} lg={12}>
          <QueueBlock
            title="Аварии: требуется действие"
            count={queue.incidentsAction.length}
            to="/incidents"
            rows={queue.incidentsAction}
            label={incidentLabel}
          />
        </Col>
      </GridRow>
      {queue.requestsOverdue > 0 && (
        <Card style={{ marginBlockStart: 16, borderColor: token.colorErrorBorder }}>
          <Typography.Text type="danger">
            Просрочено обращений: {queue.requestsOverdue} — проверьте разделы «Обращения» и «Задания».
          </Typography.Text>
        </Card>
      )}
      <Card title="Сеанс" style={{ marginBlockStart: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Начат">{formatDateTime(me.session.started_at)}</Descriptions.Item>
          <Descriptions.Item label="Последняя активность">
            {formatDateTime(me.session.last_activity_at)}
          </Descriptions.Item>
          <Descriptions.Item label="Предел всего сеанса">
            {Math.round(me.session.total_limit_seconds / 3600)} ч
          </Descriptions.Item>
          <Descriptions.Item label="Бездействие до завершения">
            {Math.round(me.session.idle_limit_seconds / 60)} мин
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </PageLayout>
  );
}
