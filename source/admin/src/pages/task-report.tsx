import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  List,
  Select,
  Space,
  Typography,
  Upload,
} from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
export function TaskReportForm(
  { task, onSaved, problem = false }: {
    task: Row;
    onSaved: () => Promise<void>;
    problem?: boolean;
  },
) {
  const [files, setFiles] = useState<Row[]>(
    (task.pending_files as Row[]) ?? [],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());
  const evidence =
    (task.required_evidence as { id: string; required: boolean }[]) ?? [];
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    let attachment = files.find((f) =>
      f.filename === file.name && f.size_bytes === file.size &&
      f.status !== "complete"
    );
    try {
      if (attachment) {
        try {
          await apiFetch(`/v1/files/${attachment.id}/complete`, {
            method: "POST",
          });
          setFiles((old) =>
            old.map((f) =>
              f.id === attachment!.id ? { ...f, status: "complete" } : f
            )
          );
          return;
        } catch {
          await apiFetch(`/v1/files/${attachment.id}/retry`, {
            method: "POST",
          });
        }
      } else {
        const r = await apiFetch<{ attachment_id: string }>(
          "/v1/files/upload-url",
          {
            method: "POST",
            body: {
              owner_type: "task",
              owner_id: task.id,
              filename: file.name,
              size: file.size,
              mime: file.type,
            },
          },
        );
        attachment = {
          id: r.attachment_id,
          filename: file.name,
          size_bytes: file.size,
          status: "incomplete",
        };
        setFiles((old) => [...old, attachment!]);
      }
      await apiFetch(`/v1/files/${attachment.id}/upload`, {
        method: "POST",
        file,
      });
      await apiFetch(`/v1/files/${attachment.id}/complete`, { method: "POST" });
      setFiles((old) =>
        old.map((f) =>
          f.id === attachment!.id ? { ...f, status: "complete" } : f
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Загрузка не завершена");
    } finally {
      setBusy(false);
    }
  }
  async function submit(values: Row) {
    setBusy(true);
    setError(null);
    try {
      const rows = (values.evidence as Row[]) ?? [];
      await apiFetch(
        `/v1/tasks/${task.id}/${problem ? "problems" : "reports"}`,
        {
          method: "POST",
          idempotencyKey: key.current,
          body: problem ? values : {
            ...values,
            version: task.version,
            limitations: values.limitations ?? "",
            performed_at: new Date(String(values.performed_at)).toISOString(),
            evidence: evidence.map((e, i) => ({
              requirement_id: e.id,
              attachment_ids: rows[i]?.attachment_ids ?? [],
              ...(rows[i]?.missing_reason
                ? { missing_reason: rows[i]!.missing_reason }
                : {}),
            })),
          },
        },
      );
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить отчёт");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {error && <Alert type="error" message={error} />}
      <Form
        layout="vertical"
        onFinish={(v) => void submit(v)}
        onValuesChange={() => {
          key.current = crypto.randomUUID();
        }}
        disabled={busy}
      >
        {problem
          ? (
            <>
              <Form.Item
                name="location"
                label="Место найденной проблемы"
                rules={required}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="description"
                label="Описание проблемы"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
            </>
          )
          : (
            <>
              <Form.Item
                name="performed_work"
                label="Выполненный объём"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
              <Form.Item
                name="performed_at"
                label="Время выполнения (местное)"
                rules={required}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="result" label="Результат" rules={required}>
                <Input.TextArea />
              </Form.Item>
              <Form.Item name="limitations" label="Оставшиеся ограничения">
                <Input.TextArea />
              </Form.Item>
            </>
          )}
        {(problem || evidence.length > 0) && (
          <>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                void upload(file);
                return false;
              }}
              disabled={busy}
            >
              <Button loading={busy}>Загрузить доказательство</Button>
            </Upload>
            <List
              size="small"
              dataSource={files}
              renderItem={(file) => (
                <List.Item>
                  {String(file.filename)} — {file.status === "complete"
                    ? "Сохранён"
                    : "Не загружен: выберите этот файл ещё раз"}
                </List.Item>
              )}
            />
          </>
        )}
        {problem && (
          <Form.Item
            name="attachment_ids"
            label="Фотографии проблемы"
            rules={required}
          >
            <Select
              mode="multiple"
              options={files.filter((f) => f.status === "complete").map(
                (f) => ({ value: f.id, label: String(f.filename) }),
              )}
            />
          </Form.Item>
        )}
        {!problem && evidence.map((e, i) => (
          <div key={e.id}>
            <Typography.Text strong>
              {e.id}
              {e.required ? " — обязательно" : " — необязательно"}
            </Typography.Text>
            <Form.Item
              name={["evidence", i, "attachment_ids"]}
              label="Сохранённые файлы"
            >
              <Select
                mode="multiple"
                options={files.filter((f) => f.status === "complete").map(
                  (f) => ({ value: f.id, label: String(f.filename) }),
                )}
              />
            </Form.Item>
            <Form.Item
              name={["evidence", i, "missing_reason"]}
              label="Если обязательного доказательства нет — объясните причину"
            >
              <Input.TextArea />
            </Form.Item>
          </div>
        ))}
        <Button type="primary" htmlType="submit" loading={busy}>
          {problem ? "Сообщить о проблеме" : "Отправить отчёт"}
        </Button>
      </Form>
    </Space>
  );
}
