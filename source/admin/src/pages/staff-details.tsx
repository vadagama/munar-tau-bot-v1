import { ProcessHistory } from "../components/process-card";
import { Descriptions, List, Space, Typography } from "antd";
import { DetailSection } from "../components/detail-section";
import { ROLE_LABELS } from "../../../core/src/pdp/roles";
import { fmtDate } from "../../../core/src/bot/text";
import { type StaffCard, staffRoleLabels } from "./staff-types";
export function StaffDetails({ card }: { card: StaffCard }) {
  return (
    <>
      <DetailSection title="Профиль">
        <Descriptions
          size="small"
          column={1}
          items={[{ key: "name", label: "ФИО", children: card.full_name }, {
            key: "phone",
            label: "Телефон",
            children: card.phone_e164,
          }]}
        />
      </DetailSection>
      <DetailSection title="Роли">
        <Typography.Paragraph>
          {staffRoleLabels(card.roles)}
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          С учётом наследования: {staffRoleLabels(card.effective_roles)}
        </Typography.Text>
      </DetailSection>
      <DetailSection title="Открытые обязанности">
        <Typography.Paragraph>
          Задания: {card.workload.tasks}; обращения:{" "}
          {card.workload.requests}; расписания: {card.workload.schedules}.
        </Typography.Paragraph>
      </DetailSection>
      <ProcessHistory>
        <List
          dataSource={card.history}
          locale={{ emptyText: "Изменений ролей пока нет" }}
          renderItem={(entry) => (
            <List.Item>
              <Space direction="vertical">
                <Typography.Text>
                  {fmtDate(entry.at)} · {entry.actor_name}
                </Typography.Text>
                <Typography.Text>
                  {staffRoleLabels(entry.before?.roles ?? [])} →{" "}
                  {staffRoleLabels(entry.after?.roles ?? [])}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {entry.reason}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
        {!!card.assignments.length && (
          <Typography.Paragraph type="secondary">
            Назначения: {card.assignments.map((a) =>
              `${ROLE_LABELS[a.role]} (${
                a.status === "revoked" ? "снята" : "назначена"
              }, ${fmtDate(a.created_at)})`
            ).join("; ")}
          </Typography.Paragraph>
        )}
      </ProcessHistory>
    </>
  );
}
