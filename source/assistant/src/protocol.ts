// WS-протокол панели ↔ AssistantDO (S1.2/S1.3). Сообщения — JSON-строки.
// JWT идёт первым сообщением `{type:"auth", jwt}`, не в URL (план S1.2);
// «Очистить контекст» идёт через REST `POST /v1/assistant/clear` (новая эпоха
// DO), отдельного WS-сообщения у очистки нет.

export const AUTH_TIMEOUT_MS = 10_000;

export type ChatMessageStatus = "queued" | "running" | "done" | "unanswered" | "parked" | "failed";

/** Запись транскрипта в том виде, в каком её видит панель. */
export interface ChatMessageView {
  messageId: string;
  role: "user" | "assistant";
  text: string;
  status: ChatMessageStatus;
  error?: string;
  /** Пул карточек-ссылок из read-only инструментов (S2.1) — для ответов ассистента. */
  sources?: ChatSource[];
}

/** Ссылка на сущность из вывода инструментов (заголовок + абсолютный путь). */
export interface ChatSource {
  title: string;
  href: string;
}

/** Решение гейта (gate.ts): JWT + enabled + сверка профиля/эпохи. */
export interface AuthDecision {
  ok: boolean;
  profileId?: string;
  epoch?: number;
  reason?: string;
}

/** Состояние аутентифицированного сокета (хранится в serializeAttachment). */
export interface SocketSession {
  profileId: string;
  epoch: number;
}

// — Клиент → DO —

export interface AuthMessage {
  type: "auth";
  jwt: string;
}

export interface SubmitMessage {
  type: "message";
  messageId: string;
  text: string;
}

export interface RetryMessage {
  type: "retry";
  messageId: string;
}

export interface ResyncMessage {
  type: "resync";
}

export type ClientMessage = AuthMessage | SubmitMessage | RetryMessage | ResyncMessage;

// — DO → клиент —

export interface AuthOkMessage {
  type: "auth_ok";
  profileId: string;
  epoch: number;
}

export interface AuthErrorMessage {
  type: "auth_error";
  reason: string;
}

export interface SnapshotMessage {
  type: "snapshot";
  messages: ChatMessageView[];
}

export interface DeltaMessage {
  type: "delta";
  messageId: string;
  text: string;
}

export interface StatusMessage {
  type: "status";
  messageId: string;
  status: ChatMessageStatus;
  error?: string;
}

/** Финал операции: панель заменяет накопленный дельтами текст на text. */
export interface DoneMessage {
  type: "done";
  messageId: string;
  status: "done" | "unanswered";
  text?: string;
  error?: string;
  sources?: ChatSource[];
}

/** Полная запись транскрипта (после обрыва/пробуждения DO): заменить или добавить. */
export interface UpsertMessage {
  type: "upsert";
  message: ChatMessageView;
}

export interface ErrorMessage {
  type: "error";
  /** limit_exceeded — гейт лимитов до submit (S3.1): модель не вызывалась. */
  code: "epoch_stale" | "rejected" | "internal" | "limit_exceeded";
  message: string;
  messageId?: string;
}

export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | SnapshotMessage
  | DeltaMessage
  | StatusMessage
  | DoneMessage
  | UpsertMessage
  | ErrorMessage;

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/** Разбор сообщения клиента: null — нераспознанный формат (сокет закрывается). */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  switch (record.type) {
    case "auth":
      return typeof record.jwt === "string" && record.jwt !== "" ? { type: "auth", jwt: record.jwt } : null;
    case "message":
      if (typeof record.messageId !== "string" || record.messageId === "") return null;
      if (typeof record.text !== "string" || record.text.trim() === "") return null;
      return { type: "message", messageId: record.messageId, text: record.text };
    case "retry":
      return typeof record.messageId === "string" && record.messageId !== ""
        ? { type: "retry", messageId: record.messageId }
        : null;
    case "resync":
      return { type: "resync" };
    default:
      return null;
  }
}
