import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { apiFetch } from "../lib/api";
interface FilePayload {
  filename: string;
  content_type: string;
  data_base64: string;
}
interface Issue {
  sheet: string;
  row: number;
  field: string;
  value: unknown;
  reason: string;
  hint: string;
}
interface Batch {
  id: string;
  state: string;
  errors: Issue[];
  preview: { added: number; skipped: number };
}
export function downloadFile(file: FilePayload) {
  const data = Uint8Array.from(atob(file.data_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([data], { type: file.content_type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RegistryImportPage() {
  const [batch, setBatch] = useState<Batch | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };
  usePageRefresh(() => run(async () => {
    if (batch) setBatch(await apiFetch<Batch>(`/v1/registry/imports/${batch.id}`));
  }), !!batch && !busy);
  const upload = async (file: File) =>
    run(async () => {
      if (
        !file.name.toLowerCase().endsWith(".xlsx") ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Выберите файл .xlsx размером до 5 МБ");
      setBatch(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const created = await apiFetch<{ id: string }>("/v1/registry/imports", {
        method: "POST",
        body: { data_base64: btoa(binary) },
      });
      setBatch(await apiFetch<Batch>(`/v1/registry/imports/${created.id}`));
    });
  return (
    <PageLayout title="Первичная загрузка реестра" actions={<Space wrap>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                downloadFile(
                  await apiFetch<FilePayload>("/v1/registry/template"),
                ),
              )
            }
          >
            Скачать шаблон
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                downloadFile(
                  await apiFetch<FilePayload>("/v1/registry/export", {
                    method: "POST",
                  }),
                ),
              )
            }
          >
            Экспорт реестра
          </Button>
        </Space>}>
      <div>
        <Typography.Paragraph type="secondary">
          Четыре связанных листа: здания и паркинги, помещения, лица, связи. В
          загрузке — только собственники. Любая ошибка блокирует сохранение
          всего файла.
        </Typography.Paragraph>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Card title="1. Подготовьте Excel">

        <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
          У каждого человека обязательны ФИО и телефон. Не включайте ИИН и
          паспортные данные. Постоянные идентификаторы сохраняются в выгрузке.
          Экспорт требует отдельного права и журналируется.
        </Typography.Paragraph>
      </Card>
      <Card title="2. Загрузите и проверьте">
        <Upload
          accept=".xlsx"
          showUploadList={false}
          disabled={busy}
          beforeUpload={(file) => {
            void upload(file);
            return false;
          }}
        >
          <Button loading={busy}>Выбрать Excel</Button>
        </Upload>
      </Card>
      {batch && (
        <Card title="3. Результат проверки">
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Tag
              color={
                batch.state === "invalid"
                  ? "red"
                  : batch.state === "committed"
                    ? "green"
                    : "blue"
              }
            >
              {{
                invalid: "Есть ошибки",
                ready: "Готов к сохранению",
                committed: "Сохранён",
                uploaded: "Ожидает проверки",
              }[batch.state] ?? batch.state}
            </Tag>
            <Space size="large">
              <Statistic
                title="Будет добавлено"
                value={batch.preview?.added ?? 0}
              />
              <Statistic
                title="Уже существует"
                value={batch.preview?.skipped ?? 0}
              />
              <Statistic title="Ошибок" value={batch.errors?.length ?? 0} />
            </Space>
            {!!batch.errors?.length && (
              <>
                <Button
                  onClick={() =>
                    void run(async () =>
                      downloadFile(
                        await apiFetch<FilePayload>(
                          `/v1/registry/imports/${batch.id}/template-errors`,
                        ),
                      ),
                    )
                  }
                >
                  Скачать Excel с ошибками
                </Button>
                <Alert
                  type="error"
                  showIcon
                  message="Ни одна запись не сохранена. Исправьте все ошибки и загрузите файл заново."
                />
                <Table
                  rowKey={(_, i) => String(i)}
                  dataSource={batch.errors}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: "Лист", dataIndex: "sheet" },
                    { title: "Строка", dataIndex: "row" },
                    { title: "Поле", dataIndex: "field" },
                    {
                      title: "Значение",
                      dataIndex: "value",
                      render: (v) => String(v ?? ""),
                    },
                    { title: "Причина", dataIndex: "reason" },
                    { title: "Как исправить", dataIndex: "hint" },
                  ]}
                />
              </>
            )}
            <Button
              type="primary"
              disabled={batch.state !== "ready" || busy}
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await apiFetch(`/v1/registry/imports/${batch.id}/commit`, {
                    method: "POST",
                  });
                  setBatch(
                    await apiFetch<Batch>(`/v1/registry/imports/${batch.id}`),
                  );
                })
              }
            >
              Сохранить весь импорт
            </Button>
            <Typography.Text type="secondary">
              Импорт создаёт предварительные карточки. Доступ к боту
              подтверждается отдельно при регистрации.
            </Typography.Text>
          </Space>
        </Card>
      )}
    </PageLayout>
  );
}
