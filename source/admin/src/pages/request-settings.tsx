import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
} from "antd";
import { useCabinetIdentity } from "../lib/identity";
import { apiFetch } from "../lib/api";
type Category = {
  id: string;
  name_ru: string;
  name_kk: string;
  sort: number;
  active: boolean;
};
export function RequestSettingsPage() {
  const { identity, roles } = useCabinetIdentity();
  const allowed = !identity?.me.emulation && roles.some(role => ["chairman", "administrator", "deputy"].includes(role));
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
      if (!fileForm.isFieldsTouched()) {
        fileForm.setFieldsValue(p);
        fileForm.setFields(Object.keys(p).map(name => ({ name, touched: false })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка настроек");
    }
  };
  usePageRefresh(load, () => allowed && !busy && !fileForm.isFieldsTouched());
  useEffect(() => {
    if (allowed) void load();
  }, [allowed]);
  const save = async (
    path: string,
    body: unknown,
    method: "PATCH" | "POST",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, { method, body });
      if (path === "/v1/file-policy") fileForm.resetFields();
      else categoryForm.resetFields();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };
  if (!allowed) return <Alert type="warning" showIcon message="Настройки обращений доступны сотрудникам с правом редактирования вне эмуляции" />;
  return (
    <PageLayout title="Настройки обращений">
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
    </PageLayout>
  );
}
