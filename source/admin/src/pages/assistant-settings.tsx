// Настройки AI-ассистента (ADR-021, план S0.4): единый токен провайдера
// (write-only, в ответах только маска) и per-user kill switch с лимитами.
// Сохранение — PUT /v1/assistant/settings с причиной и Idempotency-Key;
// 409 сохраняет ввод — версия перечитывается, поля не сбрасываются.
// Раздел недоступен в эмуляции: assistant.* — privileged-действия.

import { PageLayout } from "../components/page-layout";
import { ConfigurableTable } from "../components/configurable-table";
import { usePageRefresh } from "../lib/use-page-refresh";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, InputNumber, Space, Switch, Tag, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { canSeeAssistantSettings, useCabinetIdentity } from "../lib/identity";
import type { AssistantSettingsJson, AssistantUserRowJson } from "../lib/types";

/** Тело PUT: изменённые поля настроек и/или конфиг одного сотрудника. */
interface SaveBody {
  provider?: string;
  base_url?: string;
  model_id?: string;
  api_key?: string;
  expected_version?: number;
  users?: Array<AssistantUserRowJson & { expected_version: number | null }>;
  reason: string;
}

function AssistantSettingsPage() {
  const { roles, identity } = useCabinetIdentity();
  const allowed = canSeeAssistantSettings(roles);
  // В эмуляции раздел скрыт в меню; прямой переход — только просмотр.
  const editable = allowed && !identity?.me.emulation;
  const [settings, setSettings] = useState<AssistantSettingsJson["settings"]>(null);
  const [users, setUsers] = useState<AssistantUserRowJson[]>([]);
  const [provider, setProvider] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  // Ключ идемпотентности регенерируется при изменении тела: 409 сохраняет
  // ввод, повтор осознанный (образец templates.tsx).
  const operation = useRef({ body: "", key: crypto.randomUUID() });

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  }

  async function refresh(options?: { keepDraft?: boolean }) {
    const seq = ++request.current;
    setBusy(true);
    try {
      const data = await apiFetch<AssistantSettingsJson>("/v1/assistant/settings");
      if (seq !== request.current) return;
      apply(data, !(options?.keepDraft ?? false));
      setError(undefined);
    } catch (e) {
      if (seq === request.current) fail(e);
    } finally {
      if (seq === request.current) setBusy(false);
    }
  }

  /** После 409 черновик сохраняется: обновляются только версия и таблица. */
  function apply(data: AssistantSettingsJson, fillDraft: boolean) {
    setSettings(data.settings);
    setUsers(data.users);
    if (fillDraft) {
      setProvider(data.settings?.provider ?? "");
      setBaseUrl(data.settings?.base_url ?? "");
      setModelId(data.settings?.model_id ?? "");
      setApiKey("");
    }
  }

  usePageRefresh(refresh, allowed && !busy);
  useEffect(() => {
    if (allowed) void refresh();
    return () => {
      request.current += 1;
    };
  }, [allowed]);

  async function put(body: SaveBody) {
    if (!editable) return;
    const serialized = JSON.stringify(body);
    if (operation.current.body !== serialized) {
      operation.current = { body: serialized, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const data = await apiFetch<AssistantSettingsJson>("/v1/assistant/settings", {
        method: "PUT",
        body,
        idempotencyKey: operation.current.key,
      });
      apply(data, true);
      setNotice("Сохранено");
    } catch (e) {
      // 409 CONCURRENT_MODIFICATION: ввод сохранён, актуальная версия
      // перечитана без затирания черновика — сравните и повторите осознанно.
      fail(e);
      await refresh({ keepDraft: true });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!reason.trim()) {
      setError("Укажите причину изменения");
      return;
    }
    await put({
      ...(provider.trim() !== "" && provider.trim() !== (settings?.provider ?? "") ? { provider: provider.trim() } : {}),
      ...(baseUrl.trim() !== "" && baseUrl.trim() !== (settings?.base_url ?? "") ? { base_url: baseUrl.trim() } : {}),
      ...(modelId.trim() !== "" && modelId.trim() !== (settings?.model_id ?? "") ? { model_id: modelId.trim() } : {}),
      ...(apiKey.trim() !== "" ? { api_key: apiKey.trim() } : {}),
      ...(settings ? { expected_version: settings.version } : {}),
      reason: reason.trim(),
    });
  }

  function updateUser(profileId: string, patch: Partial<AssistantUserRowJson>) {
    setUsers((rows) => rows.map((row) => (row.profile_id === profileId ? { ...row, ...patch } : row)));
  }

  async function saveUser(row: AssistantUserRowJson) {
    if (row.enabled && (row.daily_token_limit <= 0 || row.monthly_token_limit <= 0)) {
      setError("Для включённого сотрудника задайте дневной и месячный лимиты больше нуля");
      return;
    }
    await put({ users: [{ ...row, expected_version: row.version }], reason: reason.trim() || "Изменение доступа сотрудника" });
  }

  if (!allowed) {
    return <Alert type="warning" message="Нет доступа к настройкам AI-ассистента" />;
  }

  const settingsChanged =
    (provider.trim() !== "" && provider.trim() !== (settings?.provider ?? "")) ||
    (baseUrl.trim() !== "" && baseUrl.trim() !== (settings?.base_url ?? "")) ||
    (modelId.trim() !== "" && modelId.trim() !== (settings?.model_id ?? "")) ||
    apiKey.trim() !== "";

  const columns = [
    {
      title: "Сотрудник",
      render: (_: unknown, row: AssistantUserRowJson) => (
        <Space direction="vertical" size={0}>
          <span>{row.full_name}</span>
          <Typography.Text type="secondary">
            {row.roles.join(", ") || "—"}
            {row.telegram_username ? ` · @${row.telegram_username}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Включён",
      width: 120,
      render: (_: unknown, row: AssistantUserRowJson) =>
        row.profile_id ? (
          <Switch
            aria-label={`Включён ${row.full_name}`}
            checked={row.enabled}
            disabled={busy || !editable}
            onChange={(checked) => {
              updateUser(row.profile_id!, { enabled: checked });
              void saveUser({ ...row, enabled: checked });
            }}
          />
        ) : (
          <Typography.Text type="secondary">Нет профиля</Typography.Text>
        ),
    },
    {
      title: "Дневной лимит",
      width: 160,
      render: (_: unknown, row: AssistantUserRowJson) =>
        row.profile_id ? (
          <InputNumber
            aria-label={`Дневной лимит ${row.full_name}`}
            min={0}
            max={10000000}
            step={1000}
            value={row.daily_token_limit}
            disabled={busy || !editable}
            onChange={(value) => updateUser(row.profile_id!, { daily_token_limit: value ?? 0 })}
            onBlur={() => void saveUser(row)}
          />
        ) : (
          "—"
        ),
    },
    {
      title: "Месячный лимит",
      width: 160,
      render: (_: unknown, row: AssistantUserRowJson) =>
        row.profile_id ? (
          <InputNumber
            aria-label={`Месячный лимит ${row.full_name}`}
            min={0}
            max={10000000}
            step={10000}
            value={row.monthly_token_limit}
            disabled={busy || !editable}
            onChange={(value) => updateUser(row.profile_id!, { monthly_token_limit: value ?? 0 })}
            onBlur={() => void saveUser(row)}
          />
        ) : (
          "—"
        ),
    },
    {
      title: "Статус",
      width: 120,
      render: (_: unknown, row: AssistantUserRowJson) => (
        <Tag color={row.enabled ? "green" : undefined}>{row.enabled ? "Включён" : "Выключен"}</Tag>
      ),
    },
  ];

  return (
    <PageLayout title="Настройки AI-ассистента">
      <Typography.Paragraph className="cabinet-page__intro">
        Единый токен провайдера и доступ сотрудников. Ассистент по умолчанию
        выключен у всех — включайте точечно с дневным и месячным лимитом
        токенов. Токен хранится зашифрованным и в кабинете отображается маской.
      </Typography.Paragraph>
      {!editable && (
        <Alert
          type="warning"
          message="В эмуляции доступен просмотр; изменение настроек запрещено"
          style={{ marginBottom: 16 }}
        />
      )}
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      {notice && !error && <Alert type="success" message={notice} showIcon style={{ marginBottom: 16 }} />}

      <Typography.Title level={4}>Токен провайдера</Typography.Title>
      <Space direction="vertical" size="small" style={{ width: "100%", maxWidth: 640, marginBottom: 24 }}>
        <label htmlFor="assistant-provider">Провайдер</label>
        <Input
          id="assistant-provider"
          value={provider}
          maxLength={100}
          disabled={busy || !editable}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="deepseek"
        />
        <label htmlFor="assistant-base-url">Адрес API</label>
        <Input
          id="assistant-base-url"
          value={baseUrl}
          maxLength={500}
          disabled={busy || !editable}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com/v1"
        />
        <label htmlFor="assistant-model">Модель</label>
        <Input
          id="assistant-model"
          value={modelId}
          maxLength={200}
          disabled={busy || !editable}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="deepseek-chat"
        />
        <label htmlFor="assistant-api-key">
          Токен {settings?.api_key_mask ? `(задан: ${settings.api_key_mask})` : "(не задан)"}
        </label>
        <Input.Password
          id="assistant-api-key"
          value={apiKey}
          maxLength={1000}
          disabled={busy || !editable}
          placeholder={settings?.api_key_mask ? "Заменить токен" : "Вставить токен провайдера"}
          autoComplete="new-password"
          onChange={(e) => setApiKey(e.target.value)}
        />
        <label htmlFor="assistant-reason">Причина изменения</label>
        <Input.TextArea
          id="assistant-reason"
          value={reason}
          rows={2}
          disabled={busy || !editable}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          type="primary"
          loading={busy}
          disabled={!editable || busy || !settingsChanged}
          onClick={() => void saveSettings()}
        >
          Сохранить настройки
        </Button>
      </Space>

      <Typography.Title level={4}>Доступ сотрудников</Typography.Title>
      <Typography.Paragraph type="secondary">
        Переключатель и лимиты сохраняются сразу, с указанной причиной.
        Отключённый сотрудник теряет доступ на следующем сообщении ассистенту;
        расход не обнуляется.
      </Typography.Paragraph>
      <ConfigurableTable
        storageKey="columns.assistant-settings"
        settingsPlacement="inline"
        mobileSortPlacement="none"
        size="small"
        pagination={false}
        rowKey="person_id"
        dataSource={users}
        columns={columns}
      />
    </PageLayout>
  );
}

export { AssistantSettingsPage };
