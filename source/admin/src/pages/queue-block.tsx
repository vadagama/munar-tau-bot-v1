import { Badge, Card, List, Typography, theme } from "antd";
import { Link } from "react-router-dom";
import type { QueueRow } from "../lib/day-queue";
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

