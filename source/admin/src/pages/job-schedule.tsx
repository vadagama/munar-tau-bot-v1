import { ProcessOverview } from "../components/process-card";
import { ConfigurableTable } from "../components/configurable-table";
import { taskAssigneeOptions } from "./task-assignees";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
function localInput(value: unknown) {
  const d = new Date(String(value));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString()
    .slice(0, 16);
}
export function JobSchedule(
  { id, onCreated, onBusyChange, onDirtyChange }: {
    id: string; onCreated: (id: string) => void;
    onBusyChange?: (busy: boolean) => void;
    onDirtyChange?: (dirty: boolean) => void;
  },
) {
  const [data, setData] = useState<
      { schedule: Row | null; runs: Row[]; assignees: Row[] }
    >(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setBusy(true);
    apiFetch<{ schedule: Row | null; runs: Row[]; assignees: Row[] }>(
      `/v1/job-templates/${id}/schedule`,
    ).then((r) => {
      if (live) {
        setData(r);
        form.resetFields();
        form.setFieldsValue(
          r.schedule
            ? { ...r.schedule, next_run_at: localInput(r.schedule.next_run_at) }
            : { enabled: false },
        );
      }
    }).catch((e) => {
      if (live) setError(e.message);
    }).finally(() => {
      if (live) setBusy(false);
    });
    return () => {
      live = false;
    };
  }, [id, form]);
  async function refresh() {
    setData(await apiFetch(`/v1/job-templates/${id}/schedule`));
  }
  usePageRefresh(async () => {
    try {
      const next = await apiFetch<NonNullable<typeof data>>(`/v1/job-templates/${id}/schedule`);
      // Фоновое чтение обновляет запуски, сохраняя версию редактируемого расписания.
      setData(current => current ? { ...current, runs: next.runs, assignees: next.assignees } : next);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обновить запуски"); }
  }, !busy);
  async function save(values: Row) {
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch(`/v1/job-templates/${id}/schedule`, {
        method: "POST",
        body: {
          ...values,
          enabled: values.enabled === true,
          assignee_person_id: values.assignee_person_id ?? null,
          next_run_at: new Date(String(values.next_run_at)).toISOString(),
          version: data?.schedule?.version ?? 0,
        },
      });
      await refresh();
      onDirtyChange?.(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      if (isVersionConflict(e)) {
        try { await refresh(); setError(VERSION_CONFLICT_MESSAGE); }
        catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : "Не удалось обновить расписание"); }
      }
    } finally {
      setBusy(false);
    }
  }
  async function retry(run: Row) {
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch(`/v1/job-runs/${run.id}/retry`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось повторить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {error && <Alert type="error" message={error} />}
      <ProcessOverview state={data?.schedule?.enabled ? "Расписание включено" : "Расписание выключено"} due={data?.schedule?.enabled ? data.schedule.next_run_at : undefined} guidance={{
        title: data?.schedule?.enabled ? "Ожидаем следующего запуска" : "Нужно настроить расписание для регулярного запуска",
        description: "Проверьте исполнителя, дату, период и срок выполнения. Сохранение меняет расписание будущих запусков; каждый запуск создаёт отдельную общую работу и задание.",
        waitingFor: data?.schedule?.enabled ? "Система; управляющий — при изменении расписания" : "Управляющий",
      }} />
      <Typography.Paragraph>
        Предыдущие незавершённые задания сохраняются. Период и срок — календарные часы;
        дата указана во времени вашего устройства.
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => onDirtyChange?.(true)}
        onFinish={(v) => void save(v)}
        disabled={busy || !data}
      >
        <Form.Item name="enabled" valuePropName="checked">
          <Checkbox>Расписание включено</Checkbox>
        </Form.Item>
        <Form.Item name="next_run_at" label="Следующий запуск" rules={required}>
          <Input type="datetime-local" />
        </Form.Item>
        <Form.Item
          name="interval_hours"
          label="Повторять каждые, часов"
          rules={required}
        >
          <InputNumber min={1} max={8784} precision={0} />
        </Form.Item>
        <Form.Item
          name="due_hours"
          label="Срок выполнения от даты запуска, часов"
          rules={required}
        >
          <InputNumber min={1} max={8784} precision={0} />
        </Form.Item>
        <Form.Item
          name="assignee_person_id"
          label="Исполнитель (необязательно)"
        >
          <Select
            allowClear
            placeholder="Администратор назначит после создания"
            showSearch
            optionFilterProp="label"
            notFoundContent="Нет действующих сотрудников ОСИ"
            options={taskAssigneeOptions(data?.assignees ?? [])}
          />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={busy}>
          Сохранить расписание
        </Button>
      </Form>
      <ConfigurableTable storageKey="columns.job-runs" settingsPlacement="inline"
        rowKey="id"
        dataSource={data?.runs ?? []}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 650 }}
        columns={[
          {
            title: "Дата запуска",
            dataIndex: "scheduled_at",
            render: (v) => new Date(String(v)).toLocaleString("ru-RU"),
          },
          { title: "Версия методички", dataIndex: "template_version" },
          {
            title: "Задание",
            render: (_, r) =>
              r.task_id
                ? (
                  <Button onClick={() => onCreated(String(r.task_id))}>
                    {String(r.number)}
                  </Button>
                )
                : "Ожидает создания",
          },
          {
            title: "Результат",
            render: (_, r) =>
              r.missed_at
                ? "Пропуск срока зафиксирован"
                : r.state === "dead"
                ? "Ошибка создания — требуется проверить права и настройки"
                : r.state === "done"
                ? "Задание создано"
                : "В очереди",
          },
          {
            title: "Действие",
            render: (_, r) =>
              r.state === "dead"
                ? (
                  <Button disabled={busy} onClick={() => void retry(r)}>
                    Повторить создание
                  </Button>
                )
                : null,
          },
        ]}
      />
    </Space>
  );
}
