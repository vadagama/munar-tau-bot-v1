import {
  Alert,
  Button,
  Checkbox,
  Form,
  type FormInstance,
  Input,
  Select,
  Typography,
} from "antd";
import { effectiveRoles, ROLE_LABELS } from "../../../core/src/pdp/roles";
import type { StaffRole } from "../../../core/src/pdp/types";
import { type StaffCard, staffRoleLabels, type StaffRow } from "./staff-types";
const required = [{ required: true, message: "Заполните поле" }];
export function StaffRoleForm(
  {
    form,
    mode,
    card,
    saving,
    finding,
    candidates,
    availableRoles,
    onSave,
    onFind,
    onChoose,
    onChange,
  }: {
    form: FormInstance;
    mode: "create" | "edit" | "remove" | null;
    card: StaffCard | null;
    saving: boolean;
    finding: boolean;
    candidates: StaffRow[];
    availableRoles: StaffRole[];
    onSave: (values: { roles: StaffRole[]; reason: string }) => Promise<void>;
    onFind: (query: string) => Promise<void>;
    onChoose: (id: string) => Promise<void>;
    onChange: () => void;
  },
) {
  const selectedRoles = Form.useWatch("roles", form) as StaffRole[] | undefined;
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={(values) => void onSave(values)}
      disabled={saving}
      onValuesChange={() => {
        onChange();
      }}
    >
      {mode === "create" && (
        <Form.Item
          name="person_id"
          label="Зарегистрированный пользователь"
          rules={required}
        >
          <Select
            showSearch
            filterOption={false}
            loading={finding}
            onSearch={(search) => void onFind(search)}
            onChange={(id) => void onChoose(id)}
            notFoundContent={finding
              ? "Загрузка…"
              : "Подходящих пользователей не найдено"}
            options={candidates.map((p) => ({
              value: p.id,
              label: `${p.full_name} · ${p.phone_e164}`,
            }))}
          />
        </Form.Item>
      )}
      {mode !== "remove" && (
        <Form.Item
          name="roles"
          label="Роли"
          rules={[{
            validator: (_, v) =>
              v?.length
                ? Promise.resolve()
                : Promise.reject(new Error("Выберите хотя бы одну роль")),
          }]}
        >
          <Checkbox.Group
            options={availableRoles.map((value) => ({
              value,
              label: ROLE_LABELS[value],
            }))}
          />
        </Form.Item>
      )}
      {mode !== "remove" && !!selectedRoles?.length && (
        <Typography.Paragraph type="secondary">
          С учётом наследования:{" "}
          {staffRoleLabels(effectiveRoles(selectedRoles))}
        </Typography.Paragraph>
      )}
      {mode === "remove" && (
        <Alert
          type="warning"
          showIcon
          message="Будут сняты все служебные роли. Профиль жителя и история сохранятся."
          description={`Открытые обязанности. Задания: ${
            card?.workload.tasks ?? 0
          }; обращения: ${card?.workload.requests ?? 0}; расписания: ${
            card?.workload.schedules ?? 0
          }. Они останутся видны администратору, заместителю и председателю ОСИ для передачи.`}
        />
      )}
      <Form.Item name="reason" label="Причина изменения" rules={required}>
        <Input.TextArea maxLength={1000} rows={3} />
      </Form.Item>
      <Button
        htmlType="submit"
        type="primary"
        danger={mode === "remove"}
        loading={saving}
        disabled={!card || finding || !card.can_edit}
      >
        {mode === "create"
          ? "Добавить сотрудника"
          : mode === "remove"
          ? "Прекратить полномочия"
          : "Сохранить роли"}
      </Button>
    </Form>
  );
}
