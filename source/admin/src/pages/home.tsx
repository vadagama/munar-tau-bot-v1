import { Card, Descriptions, Space, Spin, Tag, Typography } from "antd";
import { useLogout } from "@refinedev/core";

import { useCabinetIdentity } from "../lib/identity";

const ROLE_LABELS: Record<string, string> = {
  administrator: "Администратор",
  deputy: "Заместитель",
  chairman: "Председатель",
  tech_admin: "Технический администратор",
  duty: "Дежурный",
  doc_reviewer: "Проверяющий документов",
  finance: "Финансы",
  executor: "Исполнитель",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU");
}

// Главная (Task 7): идентичность, роли с областями, пределы сеанса (AUTH-06).
export function HomePage() {
  const { identity, isLoading } = useCabinetIdentity();
  const { mutate: logout } = useLogout();

  if (isLoading || !identity) {
    return <Spin size="large" style={{ display: "block", margin: "80px auto" }} />;
  }

  const { me } = identity;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Идентичность" extra={<Typography.Link onClick={() => logout()}>Выйти</Typography.Link>}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="ФИО">{me.person.full_name}</Descriptions.Item>
          <Descriptions.Item label="Профиль">
            {me.profile.is_test ? <Tag color="orange">тестовый</Tag> : null} {me.profile.id.slice(0, 8)}…
          </Descriptions.Item>
          <Descriptions.Item label="Язык">{me.profile.language}</Descriptions.Item>
          <Descriptions.Item label="Статус персоны">{me.person.status}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Роли и области">
        {me.assignments.length === 0 ? (
          <Typography.Text type="secondary">
            Действующих назначений нет: вход не выдаёт роль (AUTH-01). Обратитесь к председателю.
          </Typography.Text>
        ) : (
          <Descriptions column={1} size="small">
            {me.assignments.map((assignment) => (
              <Descriptions.Item
                key={assignment.id}
                label={ROLE_LABELS[assignment.role] ?? assignment.role}
              >
                {assignment.scope_building_ids === null
                  ? "Весь ОСИ"
                  : assignment.scope_building_ids.length === 0
                    ? "Область не назначена"
                    : `Домов в области: ${assignment.scope_building_ids.length}`}
                {assignment.financial_rights ? <Tag color="gold">финансы</Tag> : null}
                {assignment.registry_export_rights ? <Tag color="gold">выгрузка реестра</Tag> : null}
                {assignment.regulations_rights ? <Tag color="gold">регламенты</Tag> : null}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Card>

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
    </Space>
  );
}
