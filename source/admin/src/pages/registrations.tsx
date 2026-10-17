import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { displayKind, displayRole } from "./registry";
type Row = Record<string, unknown>;
const STATES: Record<string, string> = {
  pending_review: "Ожидает проверки",
  need_clarification: "Нужны уточнения",
  approved: "Доступ подтверждён",
  rejected: "Отказано",
  disputed: "Спор",
  withdrawn: "Отозвана",
};
const REASON_LABELS: Record<string, string> = {
  clarify: "Вопрос заявителю",
  reject: "Основание отказа",
  dispute: "Основание спора",
};
export function RegistrationsPage() {
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [state, setState] = useState<string>(),
    [action, setAction] = useState<{ row: Row; decision: string } | null>(null),
    [persons, setPersons] = useState<Row[]>([]),
    [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<Row[]>([]);
  const [form] = Form.useForm();
  const approveDraft =
    action?.decision === "approve"
      ? (action.row.draft as Row | undefined)
      : undefined;
  const matchedPersons = approveDraft?.phone_e164
    ? persons.filter(
        (p) => String(p.phone_e164) === String(approveDraft.phone_e164),
      )
    : [];
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [r, n, f] = await Promise.all([
        apiFetch<{ items: Row[] }>("/v1/registrations"),
        apiFetch<{ items: Row[] }>("/v1/registry/persons"),
        apiFetch<{ items: Row[] }>("/v1/registry/notification-failures"),
      ]);
      setRows(r.items);
      setPersons(n.items);
      setFailures(f.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const decide = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await apiFetch(
        `/v1/registrations/${action!.row.id}/${action!.decision}`,
        { method: "POST", body: values },
      );
      setAction(null);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2}>Регистрация и споры</Typography.Title>
        <Typography.Paragraph type="secondary">
          Проверьте анкету по реестру. Выбор роли пользователем не предоставляет
          доступ. Спор остаётся открытым до явного решения.
        </Typography.Paragraph>
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}
      <Space>
        <Select
          aria-label="Состояние анкеты"
          allowClear
          placeholder="Все состояния"
          style={{ width: 240 }}
          value={state}
          onChange={setState}
          options={Object.entries(STATES).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Button onClick={() => void load()} loading={busy}>
          Обновить
        </Button>
      </Space>
      {!!failures.length && (
        <Alert
          type="warning"
          showIcon
          message={`Не доставлены уведомления: ${failures.length}`}
          description={
            <ul>
              {failures.slice(0, 10).map((f) => (
                <li key={String(f.id)}>
                  Анкета {String(f.registration_id)}: {String(f.last_error)};
                  попыток {String(f.attempts)}
                </li>
              ))}
            </ul>
          }
        />
      )}
      <Table
        rowKey="id"
        loading={busy}
        dataSource={rows.filter((r) => !state || r.state === state)}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: "Заявитель",
            render: (_, r) => {
              const d = r.draft as Row;
              return (
                <>
                  {String(d?.full_name ?? "—")}
                  <br />
                  <Typography.Text type="secondary">
                    {String(d?.phone_e164 ?? "")}
                  </Typography.Text>
                </>
              );
            },
          },
          {
            title: "Помещение",
            render: (_, r) =>
              `${r.building_code} · ${displayKind(r.kind)} ${r.number}`,
          },
          { title: "Отношение", dataIndex: "role", render: displayRole },
          {
            title: "Состояние",
            dataIndex: "state",
            render: (v) => (
              <Tag color={v === "disputed" ? "orange" : undefined}>
                {STATES[String(v)]}
              </Tag>
            ),
          },
          {
            title: "Срок",
            render: (_, r) => (
              <>
                {r.stage_due_at
                  ? new Date(String(r.stage_due_at)).toLocaleString("ru-RU")
                  : "—"}
                {r.overdue_at && <Tag color="red">Просрочено</Tag>}
              </>
            ),
          },
          {
            title: "Действия",
            render: (_, r) => (
              <Space wrap>
                {(r.state === "approved"
                  ? ["dispute"]
                  : [
                        "pending_review",
                        "need_clarification",
                        "disputed",
                      ].includes(String(r.state))
                    ? ["approve", "clarify", "reject"]
                    : []
                ).map((decision) => (
                  <Button
                    key={decision}
                    danger={decision === "reject"}
                    onClick={() => {
                      form.resetFields();
                      setAction({ row: r, decision });
                    }}
                  >
                    {
                      {
                        approve: "Подтвердить",
                        clarify: "Уточнить",
                        reject: "Отказать",
                        dispute: "Открыть спор",
                      }[decision]
                    }
                  </Button>
                ))}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={
          action?.decision === "approve"
            ? "Подтверждение анкеты"
            : "Решение по анкете"
        }
        open={!!action}
        onCancel={() => setAction(null)}
        onOk={() => void decide()}
        confirmLoading={saving}
        okText={
          action?.decision === "approve" ? "Подтвердить" : "Сохранить решение"
        }
        cancelText="Отмена"
      >
        <Form name="registration-decision" form={form} layout="vertical">
          {action?.decision === "approve" ? (
            <>
              <Typography.Paragraph>
                Подтвердить анкету{" "}
                <Typography.Text strong>
                  {String(approveDraft?.full_name ?? "—")}
                </Typography.Text>{" "}
                ({String(approveDraft?.phone_e164 ?? "")})?
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                В реестре создаётся карточка заявителя и подтверждается доступ:
                {" "}
                {String(action.row.building_code)} · {displayKind(action.row.kind)}{" "}
                {String(action.row.number)}, {displayRole(action.row.role)}.
              </Typography.Paragraph>
              {!!matchedPersons.length && (
                <Form.Item
                  name="person_id"
                  label="В реестре уже есть карточка с этим телефоном"
                  required
                  extra="Привяжите анкету к ней. Если это другой человек — сначала исправьте телефон в реестре."
                  rules={[{ required: true, message: "Выберите карточку" }]}
                >
                  <Select
                    options={matchedPersons.map((p) => ({
                      value: String(p.id),
                      label: `${p.full_name} · ${p.phone_e164}`,
                    }))}
                  />
                </Form.Item>
              )}
            </>
          ) : (
            <Form.Item
              name="reason"
              label={
                REASON_LABELS[action?.decision ?? ""] ??
                "Основание решения или вопрос заявителю"
              }
              rules={[{ required: true, message: "Укажите основание" }]}
            >
              <Input.TextArea maxLength={300} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Space>
  );
}
