import { ConfigurableTable } from "../components/configurable-table";
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
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { ApiClientError, apiFetch } from "../lib/api";
import type { EmulationPersonsResponse, EmulationPersonJson } from "../lib/types";



// Эмуляция (Task 7, HLD 10.8): тестовые персоны с ролями, старт/завершение
// сеанса эмуляции. Роли персонам назначает председатель через раздел
// назначений; снимать роли тестовых персон можно здесь — с причиной,
// журналированием и уведомлением персоне (эмуляция не расширяет полномочия
// техадминистратора: действие выполняет реальный техадмин).
export function EmulationPage() {
  const { identity, refreshIdentity } = useCabinetIdentity();
  const pending = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [persons, setPersons] = useState<EmulationPersonJson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ full_name: string }>();
  const [revokeTarget, setRevokeTarget] = useState<{ assignmentId: string; personName: string; roleLabel: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeForm] = Form.useForm<{ reason: string }>();

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

  const revokeRole = async () => {
    if (!revokeTarget) return;
    try {
      const values = await revokeForm.validateFields();
      setRevoking(true);
      setError(null);
      await apiFetch(`/v1/emulation/assignments/${revokeTarget.assignmentId}/revoke`, {
        method: "POST",
        body: { reason: values.reason },
      });
      setNotice(`Роль «${revokeTarget.roleLabel}» снята с персоны «${revokeTarget.personName}».`);
      setRevokeTarget(null);
      revokeForm.resetFields();
      await load();
      await refreshIdentity();
    } catch (requestError) {
      setError(requestError instanceof ApiClientError ? requestError.message : "Не удалось снять роль");
    } finally {
      setRevoking(false);
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
            {record.assignments.map((assignment) => {
              const roleLabel = EMULATION_ROLE_LABELS[assignment.role] ?? assignment.role;
              return (
                <Tag
                  key={assignment.id}
                  closable
                  onClose={(e) => {
                    e.preventDefault();
                    setNotice(null);
                    setError(null);
                    revokeForm.resetFields();
                    setRevokeTarget({ assignmentId: assignment.id, personName: record.person.full_name, roleLabel });
                  }}
                >
                  {roleLabel}
                </Tag>
              );
            })}
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
      <RegistrationSimulator key={identity?.me.emulation?.session_id ?? "inactive"} active={!!identity?.me.emulation && !switching}/>
      {loading ? (
        <Spin size="large" style={{ display: "block", margin: "60px auto" }} />
      ) : (
        <ConfigurableTable storageKey="columns.emulation" settingsPlacement="page" rowKey={(record) => record.person.id} size="small" columns={columns} scroll={{ x: 600 }} dataSource={persons} pagination={false} />
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
      <Modal
        title="Снять роль"
        open={revokeTarget !== null}
        onCancel={() => setRevokeTarget(null)}
        onOk={() => void revokeRole()}
        okText="Снять роль"
        okButtonProps={{ danger: true, disabled: revoking }}
        cancelText="Отмена"
      >
        {revokeTarget !== null && (
          <Form form={revokeForm} layout="vertical" onFinish={() => void revokeRole()}>
            <Typography.Paragraph>
              Снять роль «{revokeTarget.roleLabel}» с персоны «{revokeTarget.personName}»? Персона
              сохранится как житель; при сокращении ролей её сеансы будут завершены.
            </Typography.Paragraph>
            <Form.Item
              name="reason"
              label="Причина"
              rules={[{ required: true, message: "Укажите причину снятия роли" }]}
            >
              <Input.TextArea rows={3} maxLength={500} placeholder="Например: роль выдавалась для проверки сценария" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </PageLayout>
  );
}
