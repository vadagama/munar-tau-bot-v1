import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import "./templates.css";
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
  buttons_ru?: Record<string, string>;
  buttons_kk?: Record<string, string>;
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
  scenario?: string;
  command?: string;
  effective_ru?: string;
  effective_kk?: string;
  buttons?: {
    id: string;
    ru: string;
    kk: string;
    variables?: { name: string; description: string; example: string }[];
  }[];
  examples?: { id: string; title: string }[];
  legacy?: {
    key: string;
    title: string;
    version: number;
    unresolved: boolean;
  }[];
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
  const [buttonsRu, setButtonsRu] = useState<Record<string, string>>({});
  const [buttonsKk, setButtonsKk] = useState<Record<string, string>>({});
  const [example, setExample] = useState<string>();
  const [previewLang, setPreviewLang] = useState<"ru" | "kk">("ru");
  const [legacyVersions, setLegacyVersions] = useState<Version[]>([]);
  const previewRequest = useRef(0);
  const [items, setItems] = useState<Template[]>([]),
    [selected, setSelected] = useState<Template | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [ru, setRu] = useState(""),
    [kk, setKk] = useState(""),
    [reason, setReason] = useState(""),
    [search, setSearch] = useState(""),
    [section, setSection] = useState<string>(),
    [preview, setPreview] = useState<
      {
        ru: string;
        kk: string;
        buttons_ru?: string[][];
        buttons_kk?: string[][];
        parts_ru?: string[];
        parts_kk?: string[];
      } | null
    >(null),
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
  usePageRefresh(refresh, allowed && !busy);
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
        : row.effective_ru ?? row.default_ru,
    );
    setKk(
      row.active && !row.active.use_default
        ? row.active.text_kk!
        : row.effective_kk ?? row.default_kk,
    );
    setButtonsRu(
      Object.fromEntries(
        (row.buttons ?? []).map(
          (b) => [b.id, row.active?.buttons_ru?.[b.id] ?? b.ru],
        ),
      ),
    );
    setButtonsKk(
      Object.fromEntries(
        (row.buttons ?? []).map(
          (b) => [b.id, row.active?.buttons_kk?.[b.id] ?? b.kk],
        ),
      ),
    );
    setExample(row.examples?.[0]?.id);
    setLegacyVersions([]);
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
      ...(extra ??
        {
          text_ru: ru,
          text_kk: kk,
          buttons_ru: buttonsRu,
          buttons_kk: buttonsKk,
        }),
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
    const key = selected.key,
      seq = ++previewRequest.current,
      body = {
        key,
        text_ru: ru,
        text_kk: kk,
        buttons_ru: buttonsRu,
        buttons_kk: buttonsKk,
        example,
      };
    setBusy(true);
    setError(undefined);
    try {
      const data = await apiFetch<
        {
          ru: string;
          kk: string;
          buttons_ru: string[][];
          buttons_kk: string[][];
          parts_ru?: string[];
          parts_kk?: string[];
        }
      >(
        "/v1/templates/preview",
        { method: "POST", body, idempotencyKey: crypto.randomUUID() },
      );
      if (selectedKey.current === key && previewRequest.current === seq) {
        setPreview(data);
      }
    } catch (e) {
      fail(e);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!selected) return;
    const key = selected.key, seq = ++previewRequest.current;
    const timer = setTimeout(() => {
      void apiFetch<
        {
          ru: string;
          kk: string;
          buttons_ru: string[][];
          buttons_kk: string[][];
          parts_ru?: string[];
          parts_kk?: string[];
        }
      >("/v1/templates/preview", {
        method: "POST",
        body: {
          key,
          text_ru: ru,
          text_kk: kk,
          buttons_ru: buttonsRu,
          buttons_kk: buttonsKk,
          example,
        },
        idempotencyKey: crypto.randomUUID(),
      }).then((data) => {
        if (selectedKey.current === key && previewRequest.current === seq) {
          setPreview(data);
          setError(undefined);
        }
      }).catch((e) => {
        if (selectedKey.current === key && previewRequest.current === seq) {
          setPreview(null);
          fail(e);
        }
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      previewRequest.current++;
    };
  }, [selected, ru, kk, buttonsRu, buttonsKk, example]);
  if (!allowed) {
    return <Alert type="warning" message="Нет доступа к шаблонам" />;
  }
  const filtered = items.filter((i) =>
    (!section || i.section === section) &&
    `${i.scenario ?? ""} ${
      i.command ?? ""
    } ${i.title} ${i.key} ${i.description}`.toLowerCase().includes(
      search.toLowerCase(),
    )
  );
  return (
    <PageLayout title="Шаблоны сообщений"
      filters={<Space wrap>
        <Input.Search
          aria-label="Поиск шаблонов"
          placeholder="Сценарий, команда или сообщение"
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
      </Space>}>

      <Typography.Paragraph>
        Выберите сценарий и шаг: редактируется целое сообщение с кнопками.
        Справа показан ответ жителю на вымышленных данных. История изменений
        сохраняется.
      </Typography.Paragraph>
      {error && !selected && <Alert type="error" message={error} showIcon />}

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
            <Collapse
              defaultActiveKey={[
                filtered.find((i) => i.section === id)?.scenario ?? "Сообщения",
              ]}
              items={[
                ...new Set(
                  filtered.filter((i) => i.section === id).map((i) =>
                    i.scenario ?? "Сообщения"
                  ),
                ),
              ].map((scenario) => ({
                key: scenario,
                label: scenario,
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="key"
                    dataSource={filtered.filter((i) =>
                      i.section === id &&
                      (i.scenario ?? "Сообщения") === scenario
                    )}
                    columns={[{
                      title: "Шаг / вариант сообщения",
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
                          ? new Date(row.active.created_at).toLocaleString(
                            "ru-RU",
                          )
                          : "—",
                    }]}
                  />
                ),
              }))}
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
        width="min(1360px, 100vw)"
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
              {selected.scenario} {selected.command} · {selected.description}
            </Typography.Text>
            {!editable && (
              <Alert
                message="В эмуляции доступен просмотр; редактирование глобальных шаблонов запрещено"
                type="warning"
              />
            )}
            {error && <Alert type="error" message={error} showIcon />}
            {!!selected.legacy?.length && (
              <Alert
                type="warning"
                message="Есть настройки предыдущего каталога"
                description={
                  <Space direction="vertical">
                    <span>
                      Однозначные фрагменты перенесены в текст. Отмеченные ниже
                      требуют сверки перед сохранением. Старые версии сохранены.
                    </span>
                    {selected.legacy.map((item) => (
                      <Button
                        key={item.key}
                        type="link"
                        onClick={async () => {
                          try {
                            const data = await apiFetch<{ items: Version[] }>(
                              `/v1/templates/${
                                encodeURIComponent(item.key)
                              }/versions`,
                            );
                            if (
                              selectedKey.current === selected.key
                            ) setLegacyVersions(data.items);
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        {item.title}
                        {item.unresolved
                          ? " — требуется сверка"
                          : " — перенесён"}
                      </Button>
                    ))}
                    {legacyVersions.map((v) => (
                      <div key={v.version}>
                        <b>Прежняя версия {v.version}</b>
                        <pre>{v.text_ru}</pre>
                        <pre>{v.text_kk}</pre>
                      </div>
                    ))}
                  </Space>
                }
              />
            )}
            <div className="template-workspace">
              <div className="template-editor">
                <Typography.Title level={4}>Полное сообщение</Typography.Title>
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
                {!!selected.buttons?.length && (
                  <>
                    <Typography.Title level={4}>Кнопки</Typography.Title>
                    <Typography.Paragraph type="secondary">
                      Изменяется подпись. Действие и условия показа определяет
                      сценарий.
                    </Typography.Paragraph>
                    {selected.buttons.map((button) => (
                      <Card key={button.id} size="small" title={button.ru}>
                        <label htmlFor={`button-ru-${button.id}`}>
                          Подпись — русский
                        </label>
                        <Input
                          id={`button-ru-${button.id}`}
                          maxLength={64}
                          disabled={!editable || busy}
                          value={buttonsRu[button.id]}
                          onChange={(e) => {
                            setButtonsRu({
                              ...buttonsRu,
                              [button.id]: e.target.value,
                            });
                            setPreview(null);
                          }}
                        />
                        <label htmlFor={`button-kk-${button.id}`}>
                          Подпись — қазақша
                        </label>
                        <Input
                          id={`button-kk-${button.id}`}
                          maxLength={64}
                          disabled={!editable || busy}
                          value={buttonsKk[button.id]}
                          onChange={(e) => {
                            setButtonsKk({
                              ...buttonsKk,
                              [button.id]: e.target.value,
                            });
                            setPreview(null);
                          }}
                        />
                        {button.variables?.map((v) => (
                          <Typography.Text key={v.name} type="secondary">
                            {`{${v.name}} — ${v.description} `}
                          </Typography.Text>
                        ))}
                      </Card>
                    ))}
                  </>
                )}
              </div>
              <div className="template-preview">
                <Typography.Title level={4}>
                  Как увидит получатель
                </Typography.Title>
                <Space wrap>
                  <Select
                    aria-label="Язык предпросмотра"
                    value={previewLang}
                    onChange={setPreviewLang}
                    options={[{ value: "ru", label: "Русский" }, {
                      value: "kk",
                      label: "Қазақша",
                    }]}
                  />
                  {!!selected.examples?.length && (
                    <Select
                      aria-label="Пример данных"
                      value={example}
                      onChange={(value) => {
                        setExample(value);
                        setPreview(null);
                      }}
                      options={selected.examples.map((e) => ({
                        value: e.id,
                        label: e.title,
                      }))}
                    />
                  )}
                </Space>
                <Button
                  onClick={() => void showPreview()}
                  disabled={busy}
                >
                  Предпросмотр
                </Button>
                {preview
                  ? (
                    <div className="telegram-preview">
                      {((previewLang === "ru"
                        ? preview.parts_ru
                        : preview.parts_kk) ?? [preview[previewLang]]).map((
                          part,
                          index,
                        ) => (
                          <div
                            key={index}
                            className="telegram-message"
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                              marginBottom: 8,
                            }}
                            dangerouslySetInnerHTML={{ __html: part }}
                          />
                        ))}
                      {(previewLang === "ru"
                        ? preview.buttons_ru
                        : preview.buttons_kk)?.map((row, i) => (
                          <div className="telegram-buttons" key={i}>
                            {row.map((label, j) => (
                              <div className="telegram-button" key={j}>
                                {label}
                              </div>
                            ))}
                          </div>
                        ))}
                      <Typography.Text type="secondary">
                        Пример на вымышленных данных
                      </Typography.Text>
                    </div>
                  )
                  : (
                    <Alert
                      type="info"
                      message="Нажмите «Предпросмотр», чтобы увидеть сообщение с текущим текстом и кнопками."
                    />
                  )}
              </div>
            </div>
            <label htmlFor="template-reason">Причина изменения</label>
            <Input.TextArea
              id="template-reason"
              value={reason}
              disabled={!editable || busy}
              onChange={(e) => setReason(e.target.value)}
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
                    {(["ru", "kk"] as const).map((lang) =>
                      Object.entries(v[`buttons_${lang}`] ?? {}).map((
                        [id, label],
                      ) => (
                        <Typography.Paragraph key={`${lang}-${id}`}>
                          Кнопка {selected.buttons?.find((b) =>
                            b.id === id
                          )?.[lang] ??
                            id} ({lang}): {label}
                        </Typography.Paragraph>
                      ))
                    )}
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
    </PageLayout>
  );
}
