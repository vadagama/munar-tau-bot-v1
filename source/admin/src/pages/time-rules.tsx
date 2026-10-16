import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
interface Rule {
  id: string;
  key: string;
  version: number;
  params: {
    hours: number;
    clock: string;
    start?: number;
    end?: number;
    timezone?: string;
    days?: number[];
  };
}
const names: Record<string, string> = {
  invite_expiry: "Срок приглашения",
  tenant_wait: "Ожидание собственника",
  registration_stage: "Этап рассмотрения",
  dispute_total: "Общий срок спора",
};
export function TimeRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Rule | null>(null);
  const [form] = Form.useForm();
  const load = async () => {
    setBusy(true);
    try {
      const result = await apiFetch<{ items: Rule[] }>(
        "/v1/registry/time-rules",
      );
      setRules(
        result.items
          .map((r) => ({
            ...r,
            params:
              typeof r.params === "string" ? JSON.parse(r.params) : r.params,
          }))
          .filter((r, i, a) => a.findIndex((x) => x.key === r.key) === i),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      const { reason, ...params } = values;
      await apiFetch(`/v1/registry/time-rules/${editing!.key}`, {
        method: "POST",
        body: { params, reason },
      });
      setEditing(null);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={2}>Регламенты регистрации</Typography.Title>
      <Alert
        type="info"
        showIcon
        message="Новая версия действует для новых сроков. Уже запущенные таймеры сохраняют прежнюю версию. Изменения требуют права управления регламентами и записываются в журнал."
      />
      {error && <Alert type="error" message={error} showIcon />}
      <Table
        rowKey="id"
        dataSource={rules}
        loading={busy}
        scroll={{ x: 700 }}
        columns={[
          {
            title: "Правило",
            dataIndex: "key",
            render: (v) => names[String(v)] ?? String(v),
          },
          { title: "Версия", dataIndex: "version" },
          {
            title: "Длительность",
            render: (_, r) =>
              `${r.params.hours} ${r.params.clock === "working" ? "рабочих" : "календарных"} ч`,
          },
          {
            title: "Действие",
            render: (_, r) => (
              <Button
                onClick={() => {
                  form.setFieldsValue({
                    ...r.params,
                    timezone: r.params.timezone ?? "Asia/Almaty",
                    days: r.params.days ?? [0, 1, 2, 3, 4, 5, 6],
                  });
                  setEditing(r);
                }}
              >
                Новая версия
              </Button>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? names[editing.key] : "Регламент"}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        confirmLoading={busy}
        okText="Сохранить версию"
        cancelText="Отмена"
      >
        <Form name="registration-time-rule" form={form} layout="vertical">
          <Form.Item
            name="hours"
            label="Длительность, часов"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.5} max={8784} />
          </Form.Item>
          <Form.Item
            name="clock"
            label="Отсчёт времени"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "calendar", label: "Календарное" },
                { value: "working", label: "Рабочее" },
              ]}
            />
          </Form.Item>
          <Form.Item name="start" label="Открытие, час">
            <InputNumber min={0} max={23} precision={0} />
          </Form.Item>
          <Form.Item name="end" label="Окончание, час">
            <InputNumber min={1} max={24} precision={0} />
          </Form.Item>
          <Form.Item name="timezone" label="Часовой пояс">
            <Input />
          </Form.Item>
          <Form.Item name="days" label="Рабочие дни">
            <Select
              mode="multiple"
              options={["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"].map(
                (label, value) => ({ label, value }),
              )}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Причина изменения"
            rules={[{ required: true }]}
          >
            <Input.TextArea maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
