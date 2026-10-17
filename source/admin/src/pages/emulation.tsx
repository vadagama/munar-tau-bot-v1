import { RegistrationSimulator } from "./registration-simulator";
import { useCabinetIdentity } from "../lib/identity";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { ApiClientError, apiFetch } from "../lib/api";
import type { EmulationPersonsResponse, EmulationPersonJson } from "../lib/types";

const ROLE_LABELS: Record<string, string> = {
  administrator: "Администратор",
  deputy: "Заместитель",
  chairman: "Председатель",
  tech_admin: "Техадмин",
  duty: "Дежурный",
  doc_reviewer: "Проверяющий",
  finance: "Финансы",
  executor: "Исполнитель",
};

// Эмуляция (Task 7, HLD 10.8): тестовые персоны с ролями, старт/завершение
// сеанса эмуляции. Роли персонам назначает председатель через раздел
// назначений — эмуляция не расширяет полномочия техадминистратора.
export function EmulationPage() {
  const {identity}=useCabinetIdentity();
  const [persons, setPersons] = useState<EmulationPersonJson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ full_name: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<EmulationPersonsResponse>("/v1/emulation/persons");
      setPersons(response.persons);
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Ошибка загрузки персон");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createPerson = async (values: { full_name: string }) => {
    setError(null);
    try {
      await apiFetch("/v1/emulation/persons", {
        method: "POST",
        body: { full_name: values.full_name },
      });
      setCreateOpen(false);
      form.resetFields();
      setNotice(`Тестовая персона «${values.full_name}» создана. Роль назначает председатель.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Не удалось создать персону");
    }
  };

  const startEmulation = async (person: EmulationPersonJson) => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/v1/emulation/sessions", {
        method: "POST",
        body: { emulated_profile_id: person.profile.id },
      });
      // Сеанс эмуляции влияет на весь кабинет — перезагружаем интерфейс.
      window.location.assign("/");
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Не удалось начать эмуляцию");
    }
  };

  const columns: ColumnsType<EmulationPersonJson> = [
    { title: "Имя", dataIndex: ["person", "full_name"] },
    {
      title: "Телефон (синтетический)",
      dataIndex: ["person", "phone_e164"],
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "Роли (назначает председатель)",
      key: "roles",
      render: (_: unknown, record: EmulationPersonJson) =>
        record.assignments.length === 0 ? (
          <Typography.Text type="secondary">нет — вход без роли (AUTH-01)</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {record.assignments.map((assignment) => (
              <Tag key={assignment.id}>{ROLE_LABELS[assignment.role] ?? assignment.role}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: "Действия",
      key: "actions",
      width: 200,
      render: (_: unknown, record: EmulationPersonJson) => (
        <Button type="primary" size="small" onClick={() => void startEmulation(record)}>
          Войти под персоной
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Эмуляция ролей (пилот)"
      extra={
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          Создать тестовую персону
        </Button>
      }
    >
      {error !== null && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {notice !== null && <Alert type="success" showIcon message={notice} style={{ marginBottom: 16 }} />}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Эмуляция доступна только под тестовыми персонами (is_test). Все действия журналируются с реальным актором и эмулируемой персоной; привилегированные действия недоступны."
      />
      <RegistrationSimulator active={!!identity?.me.emulation}/>
      {loading ? (
        <Spin size="large" style={{ display: "block", margin: "60px auto" }} />
      ) : (
        <Table rowKey={(record) => record.person.id} size="small" columns={columns} dataSource={persons} pagination={false} />
      )}
      <Modal
        title="Новая тестовая персона"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.submit()}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical" onFinish={(values) => void createPerson(values)}>
          <Form.Item
            name="full_name"
            label="Имя"
            rules={[{ required: true, message: "Укажите имя тестовой персоны" }]}
          >
            <Input placeholder="Например: Тестовый Администратор" />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Персона создаётся с флагом is_test и синтетическими Telegram и телефоном.
            Чтобы эмулировать роль, председателю нужно назначить её персоне через «Назначения».
          </Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
}
