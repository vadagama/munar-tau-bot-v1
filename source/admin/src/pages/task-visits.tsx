import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  List,
  Space,
  Typography,
  theme,
} from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
const labels: Record<string, string> = {
  proposed: "Предложен",
  confirmed: "Согласован",
  rescheduled: "Перенесён",
  missed: "Не состоялся",
};
const actions: Record<string, string> = {
  confirm: "Согласовать визит",
  no_show: "Исполнитель не пришёл",
  no_access: "Нет доступа",
  propose: "Предложить визит",
  review_no_show: "Проверить сообщение о неявке",
};
const required = [{ required: true, message: "Заполните поле" }];
export function TaskVisits(
  { requestId, task, canRespond = false, onChanged }: {
    requestId?: string;
    task?: Row;
    canRespond?: boolean;
    onChanged?: () => Promise<void>;
  },
) {
  const { token } = theme.useToken();
  const [rows, setRows] = useState<Row[]>((task?.visits as Row[]) ?? []),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null),
    [selected, setSelected] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    setRows((task?.visits as Row[]) ?? []);
    setAction(null);
    setError(null);
    setSuccess(null);
    if (requestId) {
      void apiFetch<{ items: Row[] }>(`/v1/requests/${requestId}/visits`).then(
        (r) => {
          if (active) setRows(r.items);
        },
      ).catch((e) => {
        if (active) setError(e.message);
      });
    }
    return () => {
      active = false;
    };
  }, [requestId, task]);
  function begin(name: string, row: Row | null = null) {
    form.resetFields();
    key.current = crypto.randomUUID();
    setSelected(row);
    setAction(name);
  }
  async function save(values: Row) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body = { ...values };
      for (const field of ["interval_start", "interval_end", "occurred_at"]) {
        if (body[field]) {
          body[field] = new Date(String(body[field])).toISOString();
        }
      }
      await apiFetch(
        action === "propose" ? "/v1/visits" : `/v1/visits/${selected!.id}`,
        {
          method: action === "propose" ? "POST" : "PATCH",
          idempotencyKey: key.current,
          body: action === "propose"
            ? { ...body, task_id: task!.id }
            : { ...body, action, version: selected!.version },
        },
      );
      setSuccess(
        action === "confirm"
          ? "Визит согласован"
          : action === "propose"
          ? "Интервал отправлен на согласование"
          : "Сообщение сохранено. Администратор проверит обстоятельства.",
      );
      setAction(null);
      if (requestId) {
        setRows(
          (await apiFetch<{ items: Row[] }>(`/v1/requests/${requestId}/visits`))
            .items,
        );
      }
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка визита");
      if (isVersionConflict(e)) {
        try {
          const fresh = requestId
            ? (await apiFetch<{ items: Row[] }>("/v1/requests/" + requestId + "/visits")).items
            : ((await apiFetch<Row>("/v1/tasks/" + task!.id)).visits as Row[]) ?? [];
          setRows(fresh);
          const next = fresh.find(row => row.id === selected?.id);
          if (next) setSelected(next);
          setError(next ? VERSION_CONFLICT_MESSAGE : "Визит больше недоступен. Вернитесь к карточке и обновите данные.");
        } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : "Не удалось обновить визиты"); }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Typography.Title level={3}>Визиты</Typography.Title>
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}
      {task && !!(task.can_manage || task.can_execute) && (
        <Button onClick={() => begin("propose")}>Предложить визит</Button>
      )}
      <List
        dataSource={rows}
        locale={{ emptyText: "Визитов пока нет" }}
        renderItem={(v) => (
          <List.Item>
            <Space direction="vertical">
              <Typography.Text>
                {new Date(String(v.interval_start)).toLocaleString("ru-RU")} —
                {" "}
                {new Date(String(v.interval_end)).toLocaleString("ru-RU")} ·
                {" "}
                {labels[String(v.status)]}
              </Typography.Text>
              <Space wrap>
                {canRespond && v.status === "proposed" && (
                  <Button onClick={() => begin("confirm", v)}>
                    Согласовать визит
                  </Button>
                )}
                {canRespond && v.status === "confirmed" && (
                  <Button onClick={() => begin("no_show", v)}>
                    Исполнитель не пришёл
                  </Button>
                )}
                {!!task?.can_execute && v.status === "confirmed" && (
                  <Button onClick={() => begin("no_access", v)}>
                    Нет доступа
                  </Button>
                )}
                {!!task?.can_manage && (
                  <Button onClick={() => begin("review_no_show", v)}>
                    Проверить сообщение о неявке
                  </Button>
                )}
              </Space>
            </Space>
          </List.Item>
        )}
      />
      <ActionPanel
        form={form}
        error={error}
        busy={busy}
        title={actions[action ?? ""]}
        open={!!action}
        onCancel={() => {
          if (!busy) setAction(null);
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => void save(v)}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
        >
          {action === "propose" && (
            <>
              <Form.Item
                name="interval_start"
                label="Начало интервала"
                rules={required}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item
                name="interval_end"
                label="Конец интервала"
                rules={required}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="note" label="Описание визита" rules={required}>
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {["no_access", "no_show", "review_no_show"].includes(action ?? "") &&
            (
              <Form.Item name="reason" label="Что произошло" rules={required}>
                <Input.TextArea />
              </Form.Item>
            )}
          {action === "review_no_show" && (
            <Form.Item name="confirmed_violation" valuePropName="checked">
              <Checkbox>Нарушение подтверждено проверкой</Checkbox>
            </Form.Item>
          )}
          {action === "no_access" && (
            <>
              <Form.Item
                name="contact_attempts"
                label="Попытки связаться"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
              <Form.Item
                name="occurred_at"
                label="Время попытки доступа"
                rules={required}
              >
                <Input type="datetime-local" />
              </Form.Item>
            </>
          )}
          <Button style={{ position: "sticky", bottom: 0, zIndex: 1, marginBlock: token.marginSM }} type="primary" htmlType="submit" loading={busy}>
            {actions[action ?? ""]}
          </Button>
        </Form>
      </ActionPanel>
    </Space>
  );
}
