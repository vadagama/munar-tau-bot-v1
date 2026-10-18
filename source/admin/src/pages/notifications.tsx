import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
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
import { useCabinetIdentity } from "../lib/identity";
interface Settings {
  language: "ru" | "kk";
  items: { event_type: string; mode: string }[];
}
interface Failure {
  id: string;
  event_type: string;
  full_name?: string;
  phone_e164?: string;
  last_error: string;
  attempts: number;
  created_at: string;
  followup_id?: string;
  followup_state?: string;
  result?: string;
}
const events: Record<string, string> = {
  "request.required": "Уточнение или согласование обращения",
  "request.status": "Статус обращения",
  "request.staff": "Обработка обращения",
  personal: "Личное уведомление",
  registration: "Регистрация",
  digest: "Ежедневная сводка",
  incident: "Авария",
  "task.assignment": "Назначение задания",
};
const errors: Record<string, string> = {
  BLOCKED_BY_USER: "Бот заблокирован получателем",
  DISPATCH_FAILED: "Не удалось подготовить уведомление",
  DELIVERY_FAILED: "Доставка не удалась",
  DELIVERY_INTERRUPTED: "Отправка прервалась",
  RECIPIENT_UNAVAILABLE: "Получатель недоступен",
};
const names: Record<string, string> = {
  publication: "Новости",
  "work.report": "Опубликованные отчёты",
  "request.status": "Изменения статуса обращений",
};
export function NotificationsPage({ section = "preferences" }: { section?: "preferences" | "failures" }) {
  const { roles } = useCabinetIdentity();
  const manager = roles.some((r) =>
    ["chairman", "administrator", "deputy"].includes(r)
  );
  const [settings, setSettings] = useState<Settings>(),
    [failures, setFailures] = useState<Failure[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [active, setActive] = useState<Failure>();
  const [form] = Form.useForm();
  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (section === "preferences") setSettings(await apiFetch<Settings>("/v1/notifications/preferences"));
      if (section === "failures" && manager) {
        setFailures(
          (await apiFetch<{ items: Failure[] }>("/v1/notifications/failures"))
            .items,
        );
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить уведомления",
      );
    } finally {
      setBusy(false);
    }
  }, [manager, section]);
  usePageRefresh(load, !busy);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (
    event_type: string,
    mode: string,
    language = settings?.language,
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      setSettings(
        await apiFetch<Settings>("/v1/notifications/preferences", {
          method: "POST",
          body: { event_type, mode, language },
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить настройки",
      );
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setError(undefined);
      await apiFetch(
        `/v1/notifications/followups/${active!.followup_id}/complete`,
        { method: "POST", body: values },
      );
      setActive(undefined);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageLayout title={section === "preferences" ? "Мои настройки" : "Ошибки доставки"}>
      {section === "failures" && !manager && <Alert type="warning" message="Нет доступа к ошибкам доставки" />}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={<Button onClick={() => void load()}>Повторить</Button>}
        />
      )}
      <Alert
        type="info"
        showIcon
        message="Запросы уточнений и согласований, результат работ, отказ, отмена и финансовые события обязательны. Аварии отправляются сразу. Доставка не означает прочтения или согласия."
      />
      {section === "preferences" && <Card title="Мои настройки" loading={!settings && busy}>
        {settings && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Space wrap>
              <Typography.Text>Язык уведомлений</Typography.Text>
              <Select
                aria-label="Язык уведомлений"
                value={settings.language}
                disabled={busy}
                options={[{ value: "ru", label: "Русский" }, {
                  value: "kk",
                  label: "Қазақша",
                }]}
                onChange={(value) =>
                  void save(
                    settings.items[0]!.event_type,
                    settings.items[0]!.mode,
                    value,
                  )}
              />
            </Space>
            {settings.items.map((item) => (
              <Space wrap key={item.event_type}>
                <Typography.Text>{names[item.event_type]}</Typography.Text>
                <Select
                  aria-label={names[item.event_type]}
                  style={{ minWidth: 210 }}
                  value={item.mode}
                  disabled={busy}
                  onChange={(mode) => void save(item.event_type, mode)}
                  options={[
                    { value: "immediate", label: "Сразу" },
                    ...(item.event_type !== "request.status"
                      ? [{ value: "digest", label: "Ежедневная сводка" }]
                      : []),
                    { value: "off", label: "Не присылать" },
                  ]}
                />
              </Space>
            ))}
            <Typography.Text type="secondary">
              Сводка приходит в конце рабочей смены. Если доступных публикаций
              нет, сообщение не отправляется.
            </Typography.Text>
          </Space>
        )}
      </Card>}
      {section === "failures" && manager && (
        <Card
          title="Ошибки доставки"
        >
          <Typography.Paragraph>
            После окончательной ошибки важной доставки создаётся задача
            связаться с получателем. Запишите фактический результат попытки;
            закрытие задачи не подтверждает согласие жителя.
          </Typography.Paragraph>
          <Table
            rowKey="id"
            loading={busy}
            dataSource={failures}
            scroll={{ x: 800 }}
            locale={{ emptyText: "Ошибок доставки в вашей области нет" }}
            columns={[
              {
                title: "Получатель",
                render: (_, r) => (
                  <Space direction="vertical" size={0}>
                    <span>{r.full_name ?? "Получатель недоступен"}</span>
                    <span>{r.phone_e164}</span>
                  </Space>
                ),
              },
              {
                title: "Событие",
                dataIndex: "event_type",
                render: (v) => events[String(v)] ?? "Уведомление",
              },
              {
                title: "Ошибка",
                dataIndex: "last_error",
                render: (v) => errors[String(v)] ?? "Ошибка доставки",
              },
              { title: "Попыток", dataIndex: "attempts" },
              {
                title: "Задача контакта",
                render: (_, r) =>
                  r.followup_state === "open"
                    ? (
                      <Button
                        onClick={() => {
                          form.resetFields();
                          setActive(r);
                        }}
                      >
                        Записать результат связи
                      </Button>
                    )
                    : r.followup_state === "done"
                    ? (
                      <Space direction="vertical">
                        <Tag>Результат записан</Tag>
                        <span>{r.result}</span>
                      </Space>
                    )
                    : "Не требуется",
              },
            ]}
          />
        </Card>
      )}
      <Modal
        open={!!active}
        title="Результат попытки связи"
        okText="Сохранить результат"
        cancelText="Отмена"
        onCancel={() => setActive(undefined)}
        onOk={() => void complete()}
        confirmLoading={busy}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="result"
            label="Что удалось выяснить"
            rules={[{
              required: true,
              whitespace: true,
              message:
                "Запишите результат, в том числе если связаться не удалось",
            }]}
          >
            <Input.TextArea rows={4} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </PageLayout>
  );
}
