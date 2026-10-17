import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
export function TaskProblems(
  { task, onSaved }: { task: Row; onSaved: () => Promise<void> },
) {
  const logs = (task.log as Row[]) ?? [],
    problems = logs.filter((l) => (l.meta as Row)?.action === "found_problem");
  const [selected, setSelected] = useState<Row | null>(null),
    [choices, setChoices] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm();
  const key = useRef(crypto.randomUUID());
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function begin(p: Row) {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ items: Row[] }>("/v1/tasks");
      setChoices(
        r.items.filter((t) => t.id !== task.id && t.state !== "canceled"),
      );
      form.resetFields();
      key.current = crypto.randomUUID();
      setSelected(p);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function save(values: Row) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/task-problems/${selected!.id}/link`, {
        method: "POST",
        body: values,
        idempotencyKey: key.current,
      });
      setSelected(null);
      await onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (!problems.length) return null;
  return (
    <>
      <Typography.Title level={4}>Найденные проблемы</Typography.Title>
      {error && <Alert type="error" message={error} />}
      <List
        dataSource={problems}
        renderItem={(p) => {
          const meta = p.meta as Row,
            linked = logs.find((l) =>
              (l.meta as Row)?.action === "problem_linked" &&
              String((l.meta as Row).problem_id) === String(p.id)
            );
          return (
            <List.Item>
              <Space direction="vertical">
                <Typography.Text strong>
                  {String(meta.location)}
                </Typography.Text>
                <Typography.Text>{String(meta.description)}</Typography.Text>
                <Space wrap>
                  {((meta.attachment_ids as string[]) ?? []).map((id) => (
                    <Button
                      key={id}
                      onClick={() =>
                        void apiFetch<{ url: string }>(`/v1/files/${id}/url`)
                          .then((r) =>
                            window.open(r.url, "_blank", "noopener,noreferrer")
                          ).catch(fail)}
                    >
                      Фото
                    </Button>
                  ))}
                </Space>
                {linked
                  ? (
                    <Typography.Text>
                      Задание: {String((linked.meta as Row).linked_task_number)}
                    </Typography.Text>
                  )
                  : !!task.can_manage && (
                    <Button
                      disabled={busy}
                      onClick={() => void begin(p)}
                    >
                      Связать с заданием
                    </Button>
                  )}
              </Space>
            </List.Item>
          );
        }}
      />
      <Modal
        title="Задание по найденной проблеме"
        open={!!selected}
        onCancel={() => !busy && setSelected(null)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          disabled={busy}
          onFinish={(v) => void save(v)}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
        >
          <Form.Item
            name="task_id"
            label="Задание"
            rules={[{ required: true, message: "Выберите задание" }]}
          >
            <Select
              options={choices.map((t) => ({
                value: t.id,
                label: `${t.number} — ${t.title}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Решение администратора"
            rules={[{ required: true, message: "Укажите решение" }]}
          >
            <Input.TextArea />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            Связать
          </Button>
        </Form>
      </Modal>
    </>
  );
}
