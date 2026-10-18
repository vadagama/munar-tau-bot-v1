import { PageLayout } from "../components/page-layout";
import { Card, Descriptions, Spin } from "antd";

import { useCabinetIdentity } from "../lib/identity";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU");
}

// Главная: пределы сеанса (AUTH-06).
export function HomePage() {
  const { identity, isLoading } = useCabinetIdentity();

  if (isLoading || !identity) {
    return <Spin size="large" style={{ display: "block", margin: "80px auto" }} />;
  }

  const { me } = identity;

  return (
    <PageLayout title="Главная">
      <Card title="Сеанс (AUTH-06)">
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
