// Изоляция Pi Durable за интерфейсом ChatRuntime (план S1.1: «Pi не протекает
// за ChatRuntime; тесты идут на фейке»). Реализация на PiHarness — pi-runtime.ts
// (S1.3, только typecheck); вся логика чата тестируется на фейках этого файла.

import type { ChatMessageStatus, ChatMessageView, ChatSource } from "./protocol.ts";

/** Обновление транскрипта, которое рантайм доставляет подписчикам. */
export type RuntimeUpdate =
  | { kind: "delta"; messageId: string; text: string }
  | { kind: "status"; messageId: string; status: ChatMessageStatus; error?: string }
  /** Полная запись (например, финальная запись Pi после обрыва соединения). */
  | { kind: "upsert"; message: ChatMessageView };

export type RuntimeListener = (update: RuntimeUpdate) => void;

export interface SubmitResult {
  /** false — операция с таким operationId уже известна (идемпотентность Pi). */
  accepted: boolean;
}

export interface WaitResult {
  status: "done" | "unanswered";
  /** Полный текст ответа при done — эталон для панели вместо накопленных дельт. */
  text?: string;
  reason?: string;
  /** Пул карточек-ссылок из вызовов инструментов этого ответа (S2.1). */
  sources?: ChatSource[];
}

export interface PendingOperation {
  messageId: string;
  status: "queued" | "running" | "parked";
}

export interface ChatRuntime {
  submit(input: { messageId: string; text: string }): Promise<SubmitResult>;
  /** Ожидание завершения операции; держит изолят живым, пока идёт ответ. */
  wait(messageId: string): Promise<WaitResult>;
  pending(): Promise<PendingOperation[]>;
  /** Текущий транскрипт для снапшота (из pi_*-хранилища Pi). */
  transcript(): Promise<ChatMessageView[]>;
  subscribe(listener: RuntimeListener): () => void;
  retry(messageId: string): Promise<void>;
  /** Сброс контекста дня (05:00 → 05:00) — транскрипт очищается. */
  reset(): Promise<void>;
}
