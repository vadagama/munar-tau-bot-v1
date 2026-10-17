import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { apiFetch } from "../lib/api";
import { canSeeTemplates, useCabinetIdentity } from "../lib/identity";
interface Version {
  version: number;
  text_ru: string | null;
  text_kk: string | null;
  use_default: boolean;
  reason: string;
  author?: string;
  created_by: string;
  created_at: string;
}
interface Template {
  key: string;
  section: string;
  title: string;
  description: string;
  variables: { name: string; description: string; example: string }[];
  default_ru: string;
  default_kk: string;
  overridden: boolean;
  active: Version | null;
}
const sections: Record<string, string> = {
  errors: "Ошибки",
  registration: "Регистрация",
  requests: "Обращения",
  tasks: "Задания",
  incidents: "Аварии",
  help: "Справка",
  notices: "Уведомления",
  common: "Общие реплики",
};
export function TemplatesPage() {
  const { roles, identity } = useCabinetIdentity();
  const allowed = canSeeTemplates(roles);
  const editable = allowed && !identity?.me.emulation;
  const [items, setItems] = useState<Template[]>([]),
    [selected, setSelected] = useState<Template | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [ru, setRu] = useState(""),
    [kk, setKk] = useState(""),
    [reason, setReason] = useState(""),
    [search, setSearch] = useState(""),
    [section, setSection] = useState<string>(),
    [preview, setPreview] = useState<{ ru: string; kk: string } | null>(null),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const request = useRef(0),
    selectedKey = useRef<string | null>(null),
    operation = useRef({ body: "", key: crypto.randomUUID() }),
    focus = useRef<"ru" | "kk">("ru"),
    ruRef = useRef<TextAreaRef>(null),
    kkRef = useRef<TextAreaRef>(null);
  function fail(e: unknown) {
    const details = (e as { details?: unknown })?.details;
    setError(
      (e instanceof Error ? e.message : "Ошибка запроса") +
        (details ? ` · ${JSON.stringify(details)}` : ""),
    );
  }
  async function refresh() {
    const seq = ++request.current;
    setBusy(true);
    try {
      const data = await apiFetch<{ items: Template[] }>("/v1/templates");
      if (seq === request.current) setItems(data.items);
    } catch (e) {
      if (seq === request.current) fail(e);
    } finally {
      if (seq === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (allowed) void refresh();
    return () => {
      request.current++;
      selectedKey.current = null;
    };
  }, [allowed]);
  async function open(row: Template) {
    selectedKey.current = row.key;
    setSelected(row);
    setVersions([]);
    setRu(
      row.active && !row.active.use_default
        ? row.active.text_ru!
        : row.default_ru,
    );
    setKk(
      row.active && !row.active.use_default
        ? row.active.text_kk!
        : row.default_kk,
    );
    setReason("");
    setPreview(null);
    setError(undefined);
    try {
      const data = await apiFetch<{ items: Version[] }>(
        `/v1/templates/${encodeURIComponent(row.key)}/versions`,
      );
      if (selectedKey.current === row.key) setVersions(data.items);
    } catch (e) {
      if (selectedKey.current === row.key) fail(e);
    }
  }
  function insert(name: string) {
    const ref = focus.current === "ru" ? ruRef : kkRef;
    const node = ref.current?.resizableTextArea?.textArea;
    const value = focus.current === "ru" ? ru : kk;
    const token = `{${name}}`;
    const from = node?.selectionStart ?? value.length,
      to = node?.selectionEnd ?? from;
    const text = value.slice(0, from) + token + value.slice(to);
    (focus.current === "ru" ? setRu : setKk)(text);
    setPreview(null);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(from + token.length, from + token.length);
    });
  }
  async function save(extra?: { use_default: true } | { rollback_to: number }) {
    if (!selected || !editable) return;
    if (!reason.trim()) {
      setError("Укажите причину изменения");
      return;
    }
    const body = {
      ...(extra ?? { text_ru: ru, text_kk: kk }),
      reason,
      base_version: selected.active?.version ?? 0,
    };
    const serialized = JSON.stringify([selected.key, body]);
    if (operation.current.body !== serialized) {
      operation.current = { body: serialized, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch(`/v1/templates/${encodeURIComponent(selected.key)}`, {
        method: "POST",
        body,
        idempotencyKey: operation.current.key,
      });
      selectedKey.current = null;
      setSelected(null);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function showPreview() {
    if (!selected) return;
    const key = selected.key, body = { key, text_ru: ru, text_kk: kk };
    setBusy(true);
    setError(undefined);
    try {
      const data = await apiFetch<{ ru: string; kk: string }>(
        "/v1/templates/preview",
        { method: "POST", body, idempotencyKey: crypto.randomUUID() },
      );
      if (selectedKey.current === key) setPreview(data);
    } catch (e) {
      fail(e);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  if (!allowed) {
    return <Alert type="warning" message="Нет доступа к шаблонам" />;
  }
  const filtered = items.filter((i) =>
    (!section || i.section === section) &&
    `${i.title} ${i.key} ${i.description}`.toLowerCase().includes(
      search.toLowerCase(),
    )
  );
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={2}>Шаблоны сообщений</Typography.Title>
      <Typography.Paragraph>
        Тексты ответов и уведомлений ботов на русском и казахском. Изменения
        применяются к следующим сообщениям; история версий сохраняется.
      </Typography.Paragraph>
      {error && !selected && <Alert type="error" message={error} showIcon />}
      <Space wrap>
        <Input.Search
          aria-label="Поиск шаблонов"
          placeholder="Название или ключ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="Секция"
          allowClear
          placeholder="Все секции"
          style={{ width: 210 }}
          value={section}
          onChange={setSection}
          options={Object.entries(sections).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Button onClick={() => void refresh()} loading={busy}>Обновить</Button>
      </Space>
      <Collapse
        defaultActiveKey={Object.keys(sections)}
        items={Object.entries(sections).filter(([id]) =>
          filtered.some((i) => i.section === id)
        ).map(([id, label]) => ({
          key: id,
          label: `${label} (${
            filtered.filter((i) => i.section === id).length
          })`,
          children: (
            <Table
              size="small"
              pagination={false}
              rowKey="key"
              dataSource={filtered.filter((i) => i.section === id)}
              columns={[{
                title: "Название",
                render: (_, row) => (
                  <Button
                    type="link"
                    onClick={() => void open(row)}
                  >
                    {row.title}
                  </Button>
                ),
              }, {
                title: "Статус",
                render: (_, row) => (
                  <Tag color={row.overridden ? "blue" : undefined}>
                    {row.overridden ? "Настроен" : "По умолчанию"}
                  </Tag>
                ),
              }, {
                title: "Изменена",
                render: (_, row) =>
                  row.active
                    ? new Date(row.active.created_at).toLocaleString("ru-RU")
                    : "—",
              }]}
            />
          ),
        }))}
      />
      {!filtered.length && !busy && (
        <Typography.Text>Шаблоны не найдены</Typography.Text>
      )}
      <Drawer
        open={!!selected}
        title={selected?.title}
        width="min(900px, 100vw)"
        onClose={() => {
          if (!busy) {
            selectedKey.current = null;
            setSelected(null);
          }
        }}
        closable={!busy}
        maskClosable={!busy}
      >
        {selected && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              {selected.description} · {selected.key}
            </Typography.Text>
            {!editable && (
              <Alert
                message="В эмуляции доступен просмотр; редактирование глобальных шаблонов запрещено"
                type="warning"
              />
            )}
            {error && <Alert type="error" message={error} showIcon />}
            <label htmlFor="template-ru">Русский</label>
            <Input.TextArea
              id="template-ru"
              ref={ruRef}
              value={ru}
              rows={6}
              showCount
              maxLength={4000}
              disabled={busy || !editable}
              onFocus={() => {
                focus.current = "ru";
              }}
              onChange={(e) => {
                setRu(e.target.value);
                setPreview(null);
              }}
            />
            <label htmlFor="template-kk">Қазақша</label>
            <Input.TextArea
              id="template-kk"
              ref={kkRef}
              value={kk}
              rows={6}
              showCount
              maxLength={4000}
              disabled={busy || !editable}
              onFocus={() => {
                focus.current = "kk";
              }}
              onChange={(e) => {
                setKk(e.target.value);
                setPreview(null);
              }}
            />
            {selected.variables.length > 0
              ? (
                <Table
                  size="small"
                  pagination={false}
                  rowKey="name"
                  dataSource={selected.variables}
                  columns={[
                    {
                      title: "Переменная",
                      render: (_, v) => <code>{`{${v.name}}`}</code>,
                    },
                    { title: "Описание", dataIndex: "description" },
                    { title: "Пример", dataIndex: "example" },
                    {
                      render: (_, v) => (
                        <Button
                          disabled={!editable || busy}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            insert(v.name)}
                        >
                          Вставить
                        </Button>
                      ),
                    },
                  ]}
                />
              )
              : (
                <Typography.Text type="secondary">
                  В этом шаблоне нет переменных
                </Typography.Text>
              )}
            <Button
              onClick={() =>
                void showPreview()}
              disabled={busy}
            >
              Предпросмотр
            </Button>
            {preview && (
              <>
                <Card size="small" title="Русский">
                  <div
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    dangerouslySetInnerHTML={{ __html: preview.ru }}
                  />
                </Card>
                <Card size="small" title="Қазақша">
                  <div
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    dangerouslySetInnerHTML={{ __html: preview.kk }}
                  />
                </Card>
              </>
            )}
            <label htmlFor="template-reason">Причина изменения</label>
            <Input.TextArea
              id="template-reason"
              value={reason}
              disabled={!editable || busy}
              onChange={(e) =>
                setReason(e.target.value)}
              rows={2}
            />
            <Space wrap>
              <Button
                type="primary"
                loading={busy}
                disabled={!editable}
                onClick={() => void save()}
              >
                Сохранить версию
              </Button>
              <Button
                disabled={!editable || busy || !selected.overridden}
                onClick={() => void save({ use_default: true })}
              >
                Сбросить к дефолту
              </Button>
            </Space>
            <Typography.Title level={4}>История версий</Typography.Title>
            <Collapse
              items={versions.map((v) => ({
                key: String(v.version),
                label: `Версия ${v.version} · ${v.author ?? v.created_by} · ${
                  new Date(v.created_at).toLocaleString("ru-RU")
                }`,
                children: (
                  <Space direction="vertical">
                    <Typography.Text>
                      {v.reason}
                      {v.use_default ? " · Сброс к дефолту" : ""}
                    </Typography.Text>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{v.text_ru}</pre>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{v.text_kk}</pre>
                    <Button
                      disabled={!editable || busy}
                      onClick={() => void save({ rollback_to: v.version })}
                    >
                      Сделать активной
                    </Button>
                  </Space>
                ),
              }))}
            />
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
