// Хук WS-сессии ассистента (план S1.2/S1.3): гейт по settings/me (бесплатный),
// JWT в первом сообщении {type:"auth"} — не в URL; снапшот + дельты; переподключение
// с обновлением токена; epoch_stale → перечитать эпоху и переподключиться;
// «Очистить контекст» — POST /v1/assistant/clear и новая эпоха (новый DO).
// В эмулированных сеансах и тестовым персонам ассистент недоступен (ADR-021).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "../lib/api";
import { appEnv } from "../lib/env";
import { useCabinetIdentity } from "../lib/identity";
import { getSupabase } from "../lib/supabase";
import type { AssistantTableData } from "./assistant-table";

/** Ответ GET /v1/assistant/settings/me (S0 + поля эпохи из S1.3). */
export interface AssistantAccess {
  enabled: boolean;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  day_used: number;
  month_used: number;
  day: string;
  month: string;
  profile_id: string;
  epoch: number;
}

/** Сообщения панели — тот же вид, что в WS-протоколе ассистента. */
export interface AssistantMessageView {
  messageId: string;
  role: "user" | "assistant";
  text: string;
  status: "queued" | "running" | "done" | "unanswered" | "parked" | "failed";
  error?: string;
  /** Пул карточек-ссылок из read-only инструментов (S2.1) — для ответов ассистента. */
  sources?: Array<{ title: string; href: string }>;
  /** Таблицы агрегатов из инструментов (S4a.2) — для ответов ассистента. */
  tables?: AssistantTableData[];
}

export type AssistantPanelStatus =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "unconfigured" }
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "limit" }
  | { kind: "error"; message: string };

interface SocketEnvelope {
  type: string;
  [key: string]: unknown;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

/** Номер UTC-суток: граница 05:00 Алматы = полночь UTC (см. assistant/almaty.ts). */
export function utcDayNumber(at: Date): number {
  return Math.floor(at.getTime() / 86_400_000);
}

/** Эффективная эпоха DO — тот же контракт, что у гейта ассистента. */
export function effectiveEpoch(configEpoch: number, at: Date): number {
  return Math.max(configEpoch, utcDayNumber(at));
}

/** Таблица агрегата из WS: проверенные id/title/колонки/строки; иначе null. */
export function parseTable(value: unknown): AssistantTableData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id === "" || typeof record.title !== "string" || record.title === "") return null;
  if (!Array.isArray(record.columns) || !Array.isArray(record.rows)) return null;
  const columns: AssistantTableData["columns"] = [];
  for (const column of record.columns) {
    if (typeof column !== "object" || column === null) continue;
    const item = column as Record<string, unknown>;
    if (typeof item.key !== "string" || item.key === "" || typeof item.title !== "string" || item.title === "") continue;
    columns.push({ key: item.key, title: item.title, kind: item.kind === "number" ? "number" : "text" });
  }
  if (columns.length === 0) return null;
  const keys = new Set(columns.map((c) => c.key));
  const rows: AssistantTableData["rows"] = [];
  for (const row of record.rows) {
    if (typeof row !== "object" || row === null) continue;
    const source = row as Record<string, unknown>;
    const parsed: AssistantTableData["rows"][number] = {};
    for (const key of keys) {
      const cell = source[key];
      parsed[key] = typeof cell === "number" && Number.isFinite(cell) ? cell : typeof cell === "string" ? cell : "";
    }
    rows.push(parsed);
  }
  return { id: record.id, title: record.title, columns, rows };
}

export function useAssistantSocket() {
  const { identity } = useCabinetIdentity();
  const me = identity?.me;
  const emulation = me?.emulation !== null && me?.emulation !== undefined;
  const testPerson = me?.person.is_test === true;

  const [access, setAccess] = useState<AssistantAccess | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageView[]>([]);
  const [connected, setConnected] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [generation, setGeneration] = useState(0);

  const generationRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const jwtRef = useRef<string | null>(null);
  /** messageId последнего отправленного вопроса — для дельт и done. */
  const aliveRef = useRef(true);

  const reloadAccess = useCallback(async () => {
    try {
      const view = await apiFetch<AssistantAccess>("/v1/assistant/settings/me");
      if (!aliveRef.current) return;
      setAccess(view);
      setAccessError(null);
    } catch (error) {
      if (!aliveRef.current) return;
      setAccess(null);
      setAccessError(error instanceof Error ? error.message : "Не удалось проверить доступ ассистента");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void reloadAccess();
    return () => {
      aliveRef.current = false;
    };
  }, [reloadAccess]);

  // Токен сеанса: чтение при подключении и реакция на refresh supabase-js.
  useEffect(() => {
    const supabase = getSupabase();
    if (supabase === null) return;
    let cancelled = false;
    const readToken = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) jwtRef.current = data.session?.access_token ?? null;
    };
    void readToken();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "SIGNED_OUT") {
        void readToken().then(() => setGeneration((value) => value + 1));
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const mergeMessage = useCallback((incoming: AssistantMessageView) => {
    setMessages((current) => {
      const at = current.findIndex((m) => m.messageId === incoming.messageId);
      if (at < 0) return [...current, incoming];
      const next = [...current];
      next[at] = { ...incoming };
      return next;
    });
  }, []);

  const handleMessage = useCallback((raw: string) => {
    let envelope: SocketEnvelope;
    try {
      envelope = JSON.parse(raw) as SocketEnvelope;
    } catch {
      return;
    }
    setSocketError(null);
    switch (envelope.type) {
      case "auth_ok":
        setConnected(true);
        return;
      case "auth_error":
        setSocketError(typeof envelope.reason === "string" ? envelope.reason : "Доступ запрещён");
        return;
      case "snapshot": {
        const incoming = Array.isArray(envelope.messages) ? envelope.messages as AssistantMessageView[] : [];
        // Оптимистичные сообщения (queued/running) поверх снапшота не теряются:
        // их финал придёт done/upsert; свёрнутый список не дублируем.
        setMessages((current) => {
          const optimistic = current.filter((m) => m.status === "queued" || m.status === "running");
          const byId = new Map<string, AssistantMessageView>();
          for (const message of [...incoming, ...optimistic]) byId.set(message.messageId, message);
          return [...byId.values()];
        });
        return;
      }
      case "delta": {
        if (typeof envelope.messageId !== "string" || typeof envelope.text !== "string") return;
        const messageId = envelope.messageId;
        const text = envelope.text;
        setMessages((current) => {
          const at = current.findIndex((m) => m.messageId === messageId);
          if (at < 0) {
            return [...current, { messageId, role: "assistant", text, status: "running" }];
          }
          const next = [...current];
          const existing = next[at]!;
          next[at] = { ...existing, text: existing.text + text, status: "running" };
          return next;
        });
        return;
      }
      case "status": {
        if (typeof envelope.messageId !== "string" || typeof envelope.status !== "string") return;
        const messageId = envelope.messageId;
        setMessages((current) => {
          const at = current.findIndex((m) => m.messageId === messageId);
          if (at < 0) return current;
          const next = [...current];
          next[at] = {
            ...next[at]!,
            status: envelope.status as AssistantMessageView["status"],
            ...(typeof envelope.error === "string" ? { error: envelope.error } : {}),
          };
          return next;
        });
        return;
      }
      case "done": {
        if (typeof envelope.messageId !== "string") return;
        const base = envelope.messageId;
        if (typeof envelope.text === "string" && envelope.text !== "") {
          // Пул источников (S2.1): ссылки только валидные пары title/href.
          const sources = Array.isArray(envelope.sources)
            ? (envelope.sources as Array<{ title?: unknown; href?: unknown }>)
              .filter((s) => typeof s?.title === "string" && typeof s?.href === "string")
              .map((s) => ({ title: s.title as string, href: s.href as string }))
            : undefined;
          // Таблицы агрегатов (S4a.2): только валидные контракты {id,title,columns,rows}.
          const tables = Array.isArray(envelope.tables)
            ? (envelope.tables as unknown[]).map(parseTable).filter((t): t is AssistantTableData => t !== null)
            : undefined;
          mergeMessage({
            messageId: `${base}:reply`,
            role: "assistant",
            text: envelope.text,
            status: "done",
            ...(sources !== undefined && sources.length > 0 ? { sources } : {}),
            ...(tables !== undefined && tables.length > 0 ? { tables } : {}),
          });
        }
        setMessages((current) => {
          const at = current.findIndex((m) => m.messageId === base);
          if (at < 0) return current;
          const next = [...current];
          const status = envelope.status === "done" ? "done" : "unanswered";
          next[at] = {
            ...next[at]!,
            status,
            ...(typeof envelope.error === "string" ? { error: envelope.error } : {}),
          };
          return next;
        });
        // Свежий расход для мини-индикатора и гейта (S3.2): один GET на ответ.
        void reloadAccess();
        return;
      }
      case "upsert": {
        const message = envelope.message as AssistantMessageView | undefined;
        if (message && typeof message.messageId === "string") mergeMessage(message);
        return;
      }
      case "error": {
        if (envelope.code === "epoch_stale") {
          setGeneration((value) => value + 1);
          void reloadAccess();
          return;
        }
        // Отказ гейта лимитов до submit (S3.1): оптимистичное сообщение —
        // сбойное с причиной, расход перечитан (day_used ≥ лимита → «лимит»).
        if (envelope.code === "limit_exceeded") {
          const messageId = typeof envelope.messageId === "string" ? envelope.messageId : null;
          const reason = typeof envelope.message === "string" && envelope.message !== ""
            ? envelope.message
            : "Лимит токенов исчерпан — повторите позже или попросите повысить лимит";
          if (messageId !== null) {
            setMessages((current) => {
              const at = current.findIndex((m) => m.messageId === messageId);
              if (at < 0) return current;
              const next = [...current];
              next[at] = { ...next[at]!, status: "failed", error: reason };
              return next;
            });
          }
          void reloadAccess();
          return;
        }
        setSocketError(typeof envelope.message === "string" ? envelope.message : "Ассистент недоступен");
        return;
      }
      default:
        return;
    }
  }, [mergeMessage, reloadAccess]);

  // WS-жизненный цикл: подключение только при включённом ассистенте, кабинете
  // вне эмуляции, настроенном WS-адресе и наличии сеанса. Токен читается перед
  // каждым подключением (истёкший → обновлённый по onAuthStateChange).
  const wsUrl = appEnv.assistantWsUrl;
  const canConnect = access?.enabled === true && !emulation && !testPerson && wsUrl !== null;
  const accessEpoch = access?.epoch ?? 0;
  const profileId = access?.profile_id ?? "";

  useEffect(() => {
    if (!canConnect) {
      setConnected(false);
      return;
    }
    aliveRef.current = true;
    const currentGeneration = ++generationRef.current;
    attemptRef.current = 0;
    let closedByUs = false;

    const connect = async () => {
      if (!aliveRef.current || generationRef.current !== currentGeneration) return;
      const supabase = getSupabase();
      const { data } = supabase === null
        ? { data: { session: null } }
        : await supabase.auth.getSession();
      const jwt = data.session?.access_token ?? null;
      if (!aliveRef.current || generationRef.current !== currentGeneration) return;
      if (jwt === null) return;
      const epoch = effectiveEpoch(accessEpoch, new Date());
      const url = `${wsUrl}?profile_id=${encodeURIComponent(profileId)}&epoch=${epoch}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;
      setConnected(false);
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "auth", jwt }));
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") handleMessage(event.data);
      };
      socket.onclose = () => {
        socketRef.current = null;
        if (closedByUs || !aliveRef.current || generationRef.current !== currentGeneration) return;
        setConnected(false);
        // Переподключение с линейно растущей паузой; токен перечитывается
        // перед каждым подключением.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
        attemptRef.current += 1;
        reconnectRef.current = window.setTimeout(() => void connect(), delay);
      };
      socket.onerror = () => {
        setSocketError("Не удалось подключиться к ассистенту");
      };
    };

    void connect();
    return () => {
      closedByUs = true;
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [canConnect, generation, accessEpoch, profileId, wsUrl, handleMessage]);

  /** Отправка вопроса: messageId = operationId (идемпотентность повтора). */
  const send = useCallback((text: string, reuseMessageId?: string) => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    const messageId = reuseMessageId ?? crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { messageId, role: "user", text, status: "queued" },
    ]);
    socket.send(JSON.stringify({ type: "message", messageId, text }));
    return true;
  }, []);

  /** Повтор: сбойная попытка заменяется новой (новый operationId). */
  const retry = useCallback((failed: AssistantMessageView) => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    if (failed.status === "parked") {
      socket.send(JSON.stringify({ type: "retry", messageId: failed.messageId }));
      return true;
    }
    // Повтор того же messageId для ещё идущей операции гасится идемпотентностью
    // сервера (accepted=false → статус); для завершённой — новая попытка.
    const inFlight = failed.status === "queued" || failed.status === "running";
    if (inFlight) {
      socket.send(JSON.stringify({ type: "message", messageId: failed.messageId, text: failed.text }));
      return true;
    }
    setMessages((current) => current.filter((m) => m.messageId !== failed.messageId));
    return send(failed.text);
  }, [send]);

  /** «Очистить контекст»: новая эпоха DO с пустой историей (S1.3). */
  const clearSession = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await apiFetch("/v1/assistant/clear", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
      });
      setMessages([]);
      setGeneration((value) => value + 1);
      await reloadAccess();
    } catch (error) {
      setSocketError(error instanceof Error ? error.message : "Не удалось очистить контекст");
    } finally {
      setClearing(false);
    }
  }, [clearing, reloadAccess]);

  const status: AssistantPanelStatus = useMemo(() => {
    if (me === undefined && access === null && accessError === null) return { kind: "loading" };
    if (emulation || testPerson) return { kind: "disabled" };
    if (access === null) {
      return accessError !== null ? { kind: "error", message: accessError } : { kind: "loading" };
    }
    if (!access.enabled) return { kind: "disabled" };
    if (wsUrl === null) return { kind: "unconfigured" };
    const daily = access.daily_token_limit;
    if (daily !== null && access.day_used >= daily) return { kind: "limit" };
    if (socketError !== null) return { kind: "error", message: socketError };
    return connected ? { kind: "open" } : { kind: "connecting" };
  }, [me, access, accessError, emulation, testPerson, wsUrl, socketError, connected]);

  return { status, messages, send, retry, clearSession, clearing, reloadAccess, access };
}
