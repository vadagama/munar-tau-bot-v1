import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
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
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
interface Rule {
  contract?: {version:number;start:string;calendar_pause:string;business_pause:string;finish:string;effect:string};
  contract_legacy?:boolean;
  id: string;
  key: string;
  version: number;
  kind: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  reason: string | null;
  legal_source: string | null;
  legal_revision: string | null;
  legal_limits: {min_hours?:number;max_hours?:number;clock?:string} | null;
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
  financial_monthly_publication: "Размещение месячного финансового отчёта",
  financial_annual_publication: "Размещение годового финансового отчёта",
  document_prepare: "Подготовка обязательного документа до приёмки",
  document_after_acceptance: "Документальное обязательство после приёмки",
  task_accept: "Ожидание принятия задания",
  task_escalation: "Повторная эскалация назначения",
  work_schedule: "Рабочий график",
  first_response: "Первый ответ",
  author_reminder: "Напоминание автору",
  request_admin_close_wait: "Проверка при отсутствии ответа автора",
  request_reopen: "Окно повторного открытия",
  digest_time: "Сводка — в конце смены",
  invite_expiry: "Срок приглашения",
  tenant_wait: "Ожидание собственника",
  registration_stage: "Этап рассмотрения",
  dispute_total: "Общий срок спора",
};
const ruleDetails=(rule:Rule)=>{
 if(!rule.version)return "Не настроен — назначение недоступно";
 const p=typeof rule.params==="string" ? JSON.parse(rule.params) as Rule["params"] : rule.params;
 return `${p.hours} ${p.clock==="working" ? "рабочих" : "календарных"} ч${p.clock==="working" ? `; график ${p.start ?? 8}:00–${p.end ?? 20}:00, ${p.timezone ?? "Asia/Almaty"}; дни: ${(p.days ?? [0,1,2,3,4,5,6]).map(d=>["Вс","Пн","Вт","Ср","Чт","Пт","Сб"][d]).join(", ")}` : ""}`;
};
export function TimeRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Rule | null>(null);
  const [history, setHistory] = useState<Rule[]>([]);
  const [form] = Form.useForm();
  const load = async () => {
    setBusy(true);
    try {
      const result = await apiFetch<{ items: Rule[] }>(
        "/v1/registry/time-rules",
      );
      setHistory(result.items);
      setRules(
        result.items
          .map((r) => ({
            ...r,
            params:
              typeof r.params === "string" ? JSON.parse(r.params) : r.params ?? {clock:"working"},
          }))
          .filter((r, i, a) => a.findIndex((x) => x.key === r.key) === i),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };
  usePageRefresh(load, !busy);
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
    <PageLayout title="Регламенты">
      <Alert
        type="info"
        showIcon
        message="Новая версия действует для новых сроков. Уже запущенные таймеры сохраняют прежнюю версию. Изменения требуют права управления регламентами и записываются в журнал."
      />
      {error && <Alert type="error" message={error} showIcon />}
      <ConfigurableTable storageKey="columns.time-rules" settingsPlacement="page"
        rowKey="key"
        dataSource={rules}
        loading={busy}
        scroll={{ x: 900 }}
        expandable={{expandedRowRender:r=><Space direction="vertical">
          {r.contract && <Typography.Paragraph>Начало: {r.contract.start}<br/>Отсчёт: {r.contract.calendar_pause}<br/>{r.contract.business_pause}<br/>Погашение: {r.contract.finish}<br/>По истечении: {r.contract.effect}<br/>Условия, версия {r.contract.version}{r.contract_legacy ? " (исходные условия старой версии)" : ""}</Typography.Paragraph>}
          {r.kind==="legal" && <Alert type="warning" message={`Правовой регламент: ${r.legal_source ?? "источник не заполнен"}; редакция: ${r.legal_revision ?? "не заполнена"}`} description={`Допустимая длительность: ${r.legal_limits?.min_hours ?? "не задана"}–${r.legal_limits?.max_hours ?? "не задана"} ч`} />}
          {history.filter(v=>v.key===r.key && v.version).map(v=><Typography.Paragraph key={v.id}>Версия {v.version} · {new Date(v.created_at).toLocaleString("ru-RU")} · автор: {v.created_by_name ?? (v.created_by ? "Сотрудник" : "Начальная настройка")}<br/>{v.reason}<br/>{ruleDetails(v)}{v.contract && <><br/>Условия, версия {v.contract.version}: {v.contract.effect}{v.contract_legacy ? " (исходные)" : ""}</>}</Typography.Paragraph>)}
        </Space>}}

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
              !r.version ? "Не настроен" : r.key==="digest_time" ? "Окончание текущей смены" : r.key==="work_schedule" ? `${r.params.start}:00–${r.params.end}:00 (${r.params.timezone})` : `${r.params.hours} ${r.params.clock === "working" ? "рабочих" : "календарных"} ч`,
          },
          {
            title: "Действие",
            render: (_, r) => (
              <Button
                disabled={r.key === "digest_time"}
                onClick={() => {
                  form.resetFields();
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
        title={editing ? names[editing.key] ?? editing.key : "Регламент"}
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
            hidden={editing?.key==="work_schedule"}
            label="Длительность, часов"
            rules={[{ required: true }]}
          >
            <InputNumber disabled={editing?.key==="work_schedule"} min={0.5} max={8784} />
          </Form.Item>
          <Form.Item
            name="clock"
            hidden={editing?.key==="work_schedule"}
            label="Отсчёт времени"
            rules={[{ required: true }]}
          >
            <Select disabled={editing?.key==="work_schedule"}
              options={[
                { value: "calendar", label: "Календарное" },
                { value: "working", label: "Рабочее" },
              ]}
            />
          </Form.Item>
          <Form.Item name="start" label="Открытие, час">
            <InputNumber disabled={editing?.key!=="work_schedule"} min={0} max={23} precision={0} />
          </Form.Item>
          <Form.Item name="end" label="Окончание, час">
            <InputNumber disabled={editing?.key!=="work_schedule"} min={1} max={24} precision={0} />
          </Form.Item>
          <Form.Item name="timezone" label="Часовой пояс">
            <Input disabled={editing?.key!=="work_schedule"} />
          </Form.Item>
          <Form.Item name="days" label="Рабочие дни">
            <Select
              disabled={editing?.key!=="work_schedule"}
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
    </PageLayout>
  );
}
