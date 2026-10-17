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
  Switch,
  Tabs,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
type Category = {
  id: string;
  name_ru: string;
  name_kk: string;
  sort: number;
  active: boolean;
};
export function RequestSettings(
  { open, onClose, onSaved }: {
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
  },
) {
  const [categories, setCategories] = useState<Category[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string>();
  const [categoryForm] = Form.useForm(), [fileForm] = Form.useForm();
  const load = async () => {
    try {
      const [c, p] = await Promise.all([
        apiFetch<{ items: Category[] }>("/v1/request-categories"),
        apiFetch<Record<string, unknown>>("/v1/file-policy"),
      ]);
      setCategories(c.items);
      fileForm.setFieldsValue(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка настроек");
    }
  };
  useEffect(() => {
    if (open) void load();
  }, [open]);
  const save = async (
    path: string,
    body: unknown,
    method: "PATCH" | "POST",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, { method, body });
      await load();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Настройки обращений"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
    >
      {error && <Alert type="error" message={error} />}
      <Tabs
        items={[{
          key: "categories",
          label: "Категории",
          children: (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                aria-label="Редактировать категорию"
                placeholder="Новая категория"
                allowClear
                value={selected}
                style={{ width: "100%" }}
                options={categories.map((c) => ({
                  value: c.id,
                  label: c.name_ru,
                }))}
                onChange={(id) => {
                  setSelected(id);
                  categoryForm.resetFields();
                  if (id) {
                    categoryForm.setFieldsValue(
                      categories.find((c) => c.id === id),
                    );
                  }
                }}
              />
              <Form
                form={categoryForm}
                layout="vertical"
                initialValues={{ sort: 0, active: true }}
                onFinish={(values) =>
                  void save(
                    selected
                      ? `/v1/request-categories/${selected}`
                      : "/v1/request-categories",
                    values,
                    selected ? "PATCH" : "POST",
                  )}
              >
                <Form.Item
                  name="name_ru"
                  label="Название на русском"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input maxLength={300} />
                </Form.Item>
                <Form.Item
                  name="name_kk"
                  label="Название на казахском"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input maxLength={300} />
                </Form.Item>
                <Form.Item name="sort" label="Порядок">
                  <InputNumber />
                </Form.Item>
                <Form.Item
                  name="active"
                  label="Активна"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={busy}>
                  Сохранить категорию
                </Button>
              </Form>
            </Space>
          ),
        }, {
          key: "files",
          forceRender: true,
          label: "Вложения",
          children: (
            <Form
              form={fileForm}
              layout="vertical"
              onFinish={(values) =>
                void save("/v1/file-policy", values, "PATCH")}
            >
              <Form.Item
                name="max_bytes"
                label="Максимальный размер в байтах"
                rules={[{ required: true }]}
              >
                <InputNumber
                  aria-label="Максимальный размер в байтах"
                  min={1}
                  max={20971520}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item
                name="max_per_message"
                label="Файлов на сообщение"
                rules={[{ required: true }]}
              >
                <InputNumber
                  aria-label="Файлов на сообщение"
                  min={1}
                  max={10}
                />
              </Form.Item>
              <Form.Item
                name="extensions"
                label="Разрешённые расширения"
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  options={"jpg jpeg png webp heic mp4 mov webm pdf zip 7z rar doc docx xls xlsx ppt pptx odt ods odp"
                    .split(" ").map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    }))}
                />
              </Form.Item>
              <Typography.Paragraph type="secondary">
                Предел пилота — 20 МиБ и 10 файлов. Антивирусная проверка не
                выполняется.
              </Typography.Paragraph>
              <Button type="primary" htmlType="submit" loading={busy}>
                Сохранить ограничения
              </Button>
            </Form>
          ),
        }]}
      />
    </Modal>
  );
}
