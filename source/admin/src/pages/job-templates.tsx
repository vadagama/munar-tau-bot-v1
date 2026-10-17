import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
export function JobTemplates(
  { onCreated }: { onCreated: (taskId: string) => void },
) {
  const [rows, setRows] = useState<Row[]>([]),
    [buildings, setBuildings] = useState<Row[]>([]),
    [versions, setVersions] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<string | null>(null);
  const [form] = Form.useForm();
  const key = useRef(crypto.randomUUID()), generation = useRef(0);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function refresh() {
    const g = ++generation.current;
    setBusy(true);
    try {
      const [templates, bs] = await Promise.all([
        apiFetch<{ items: Row[] }>("/v1/job-templates"),
        apiFetch<{ items: Row[] }>("/v1/registry/buildings"),
      ]);
      if (g === generation.current) {
        setRows(templates.items);
        setBuildings(bs.items);
      }
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, []);
  function begin(value: string, row: Row | null) {
    setSelected(row);
    setError(null);
    setAction(value);
    form.resetFields();
    key.current = crypto.randomUUID();
    if (row && value === "edit") {
      form.setFieldsValue({ ...row, ...row.blueprint as Row });
    }
  }
  async function history(row: Row) {
    const g = ++generation.current;
    setSelected(row);
    setVersions([]);
    setBusy(true);
    try {
      const r = await apiFetch<{ items: Row[] }>(
        `/v1/job-templates/${row.id}/versions`,
      );
      if (g === generation.current) setVersions(r.items);
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function save(values: Row) {
    setBusy(true);
    setError(null);
    try {
      const body: Row = { ...values, version: selected?.version };
      if (body.due_at) {
        body.due_at = new Date(String(body.due_at)).toISOString();
      }
      const r = await apiFetch<Row>(
        `/v1/job-templates${
          action === "create"
            ? ""
            : `/${selected!.id}${action === "run" ? "/run" : ""}`
        }`,
        {
          method: action === "edit" ? "PATCH" : "POST",
          body,
          idempotencyKey: key.current,
        },
      );
      setAction(null);
      if (action === "run") onCreated(String(r.task_id));
      else await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {error && <Alert type="error" message={error} />}
      <Button disabled={busy} onClick={() => begin("create", null)}>
        Создать шаблон
      </Button>
      <Table
        rowKey="id"
        loading={busy}
        dataSource={rows}
        scroll={{ x: 600 }}
        columns={[{ title: "Шаблон", dataIndex: "name" }, {
          title: "Версия",
          dataIndex: "version",
        }, {
          title: "Действия",
          render: (_, r) => (
            <Space wrap>
              <Button onClick={() => begin("edit", r)}>Новая версия</Button>
              <Button onClick={() => void history(r)}>История версий</Button>
              <Button disabled={!r.active} onClick={() => begin("run", r)}>
                Создать задание
              </Button>
            </Space>
          ),
        }]}
      />
      {!!versions.length && (
        <>
          <Typography.Title level={4}>
            {String(selected?.name)} — версии методички
          </Typography.Title>
          <List
            dataSource={versions}
            renderItem={(v) => (
              <List.Item>
                <div>
                  Версия {String(v.version)},{" "}
                  {new Date(String(v.created_at)).toLocaleString()},{" "}
                  {String(v.author_name ?? "")}
                  <p>{String((v.blueprint as Row).instruction)}</p>
                </div>
              </List.Item>
            )}
          />
        </>
      )}
      <Modal
        title={action === "run" ? "Ручной запуск задания" : "Версия шаблона"}
        open={!!action}
        onCancel={() => !busy && setAction(null)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ active: true }}
          disabled={busy}
          onValuesChange={() => {
            key.current = crypto.randomUUID();
          }}
          onFinish={(v) => void save(v)}
        >
          {action === "run"
            ? (
              <Form.Item
                name="due_at"
                label="Срок задания (местное время)"
                rules={required}
              >
                <Input type="datetime-local" />
              </Form.Item>
            )
            : (
              <>
                <Form.Item
                  name="name"
                  label="Название шаблона"
                  rules={required}
                >
                  <Input />
                </Form.Item>
                <Form.Item name="title" label="Объём задания" rules={required}>
                  <Input />
                </Form.Item>
                <Form.Item
                  name="instruction"
                  label="Утверждённая инструкция"
                  rules={required}
                >
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item name="buildings" label="Дома" rules={required}>
                  <Select
                    mode="multiple"
                    options={buildings.map((b) => ({
                      value: b.id,
                      label: String(b.name ?? b.code),
                    }))}
                  />
                </Form.Item>
                <Form.List name="required_evidence">
                  {(fields, { add, remove }) => (
                    <>
                      <Typography.Text>Чек-лист доказательств</Typography.Text>
                      {fields.map((f) => (
                        <div key={f.key}>
                          <Form.Item
                            name={[f.name, "id"]}
                            label="Пункт"
                            rules={required}
                          >
                            <Input />
                          </Form.Item>
                          <Form.Item name={[f.name, "kind"]} label="Вид">
                            <Select
                              options={[{ value: "file", label: "Файл" }, {
                                value: "photo",
                                label: "Фото",
                              }]}
                            />
                          </Form.Item>
                          <Form.Item
                            name={[f.name, "required"]}
                            valuePropName="checked"
                          >
                            <Checkbox>Обязательно</Checkbox>
                          </Form.Item>
                          <Button onClick={() => remove(f.name)}>
                            Убрать пункт
                          </Button>
                        </div>
                      ))}
                      <Button
                        onClick={() => add({ required: true, kind: "photo" })}
                      >
                        Добавить пункт
                      </Button>
                    </>
                  )}
                </Form.List>
                <Form.Item name="active" valuePropName="checked">
                  <Checkbox>Доступен для новых заданий</Checkbox>
                </Form.Item>
                {action === "edit" && (
                  <Form.Item
                    name="reason"
                    label="Причина новой версии"
                    rules={required}
                  >
                    <Input.TextArea />
                  </Form.Item>
                )}
              </>
            )}
          <Button type="primary" htmlType="submit" loading={busy}>
            Сохранить
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
