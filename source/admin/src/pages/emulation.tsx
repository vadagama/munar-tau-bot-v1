import { EMULATION_ROLE_LABELS } from "../lib/emulation-roles";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { RegistrationSimulator } from "./registration-simulator";
import { useCabinetIdentity } from "../lib/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { ApiClientError, apiFetch } from "../lib/api";
import type { EmulationPersonsResponse, EmulationPersonJson } from "../lib/types";



// Эмуляция (Task 7, HLD 10.8): тестовые персоны с ролями, старт/завершение
// сеанса эмуляции. Роли персонам назначает председатель через раздел
// назначений — эмуляция не расширяет полномочия техадминистратора.
export function EmulationPage() {
  const { identity, refreshIdentity } = useCabinetIdentity();
  const pending = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [role, setRole] = useState<string>("all");
  const [persons, setPersons] = useState<EmulationPersonJson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ full_name: string }>();

  const load = useCallback(async (silent = false) => {
    if (pending.current) return;
    pending.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<EmulationPersonsResponse>("/v1/emulation/persons");
      setPersons(response.persons);
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Ошибка загрузки персон");
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true), !loading && !switching);
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
      setNotice(`Тестовая персона «${values.full_name}» создана как житель без служебных назначений.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Не удалось создать персону");
    }
  };

  const startEmulation = async (person: EmulationPersonJson) => {
    if (pending.current || switching) return;
    pending.current = true;
    setSwitching(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/v1/emulation/sessions", {
        method: "POST",
        body: { emulated_profile_id: person.profile.id },
      });
      await refreshIdentity();
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Не удалось начать эмуляцию");
    } finally {
      pending.current = false;
      setSwitching(false);
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
          <Tag>Житель</Tag>
        ) : (
          <Space size={4} wrap>
            {record.assignments.map((assignment) => (
              <Tag key={assignment.id}>{EMULATION_ROLE_LABELS[assignment.role] ?? assignment.role}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: "Действия",
      key: "actions",
      width: 200,
      render: (_: unknown, record: EmulationPersonJson) => (
        <Button type="primary" size="small" disabled={switching} onClick={() => void startEmulation(record)}>
          Войти под персоной
        </Button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Эмуляция ролей (пилот)"
      actions={
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          Создать тестовую персону
        </Button>
      }
    >
      {error !== null && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {notice !== null && <Alert type="success" showIcon message={notice} style={{ marginBottom: 16 }} />}
      <Select aria-label="Роль тестовой персоны" value={role} onChange={setRole}
        style={{ minWidth: 200, marginBottom: 16 }}
        options={[{ value: "all", label: "Все роли" }, ...Object.entries(EMULATION_ROLE_LABELS).map(([value, label]) => ({ value, label }))]} />
      <RegistrationSimulator key={identity?.me.emulation?.session_id ?? "inactive"} active={!!identity?.me.emulation && !switching}/>
      {loading ? (
        <Spin size="large" style={{ display: "block", margin: "60px auto" }} />
      ) : (
        <Table rowKey={(record) => record.person.id} size="small" columns={columns} scroll={{ x: 600 }} dataSource={persons.filter(person => role === "all" || (role === "resident" ? person.assignments.length === 0 : person.assignments.some(assignment => assignment.role === role)))} pagination={false} />
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
            Новая персона — житель без служебных назначений. Для роли сотрудника председатель назначает полномочия через «Сотрудники».
          </Typography.Text>
        </Form>
      </Modal>
    </PageLayout>
  );
}
