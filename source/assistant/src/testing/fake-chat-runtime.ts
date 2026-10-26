// Фейк ChatRuntime для тестов ChatServer и DO: транскрипт в памяти, ручное
// управление ожиданиями и обновлениями. Повторяет контракт chat-runtime.ts.

import type {
  ChatRuntime,
  PendingOperation,
  RuntimeListener,
  RuntimeUpdate,
  SubmitResult,
  WaitResult,
} from "../chat-runtime.ts";
import type { ChatMessageStatus, ChatMessageView } from "../protocol.ts";

interface FakeWait {
  resolve(result: WaitResult): void;
}

export class FakeChatRuntime implements ChatRuntime {
  readonly messages = new Map<string, ChatMessageView>();
  readonly submitted: Array<{ messageId: string; text: string }> = [];
  readonly retried: string[] = [];
  readonly awaited: string[] = [];
  resets = 0;
  /** Результат следующего submit: false имитирует дубликат operationId. */
  nextSubmitAccepted = true;
  /** Расход операций (S3.1): выдаётся в WaitResult при finishReply. */
  readonly usageByOperation = new Map<string, { promptTokens: number; completionTokens: number }>();

  private readonly listeners = new Set<RuntimeListener>();
  private readonly waits = new Map<string, FakeWait>();

  async submit(input: { messageId: string; text: string }): Promise<SubmitResult> {
    this.submitted.push({ messageId: input.messageId, text: input.text });
    if (!this.nextSubmitAccepted) {
      this.nextSubmitAccepted = true;
      return { accepted: false };
    }
    this.messages.set(input.messageId, {
      messageId: input.messageId,
      role: "user",
      text: input.text,
      status: "queued",
    });
    return { accepted: true };
  }

  async wait(messageId: string): Promise<WaitResult> {
    this.awaited.push(messageId);
    return new Promise<WaitResult>((resolve) => {
      this.waits.set(messageId, { resolve });
    });
  }

  async pending(): Promise<PendingOperation[]> {
    const result: PendingOperation[] = [];
    for (const message of this.messages.values()) {
      if (message.status === "queued" || message.status === "running" || message.status === "parked") {
        result.push({ messageId: message.messageId, status: message.status });
      }
    }
    return result;
  }

  async transcript(): Promise<ChatMessageView[]> {
    return [...this.messages.values()];
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async retry(messageId: string): Promise<void> {
    this.retried.push(messageId);
  }

  async reset(): Promise<void> {
    this.resets += 1;
    this.messages.clear();
  }

  // — ручное управление из тестов —

  /** Ждёт, пока ChatServer зарегистрирует ожидание операции (несколько микротасков). */
  async untilAwaited(messageId: string): Promise<void> {
    while (!this.awaited.includes(messageId)) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  /** Помечает пользовательское сообщение запущенным и добавляет ответ ассистента. */
  startReply(messageId: string) {
    this.setStatus(messageId, "running");
    const replyId = `${messageId}:reply`;
    this.messages.set(replyId, { messageId: replyId, role: "assistant", text: "", status: "running" });
  }

  /** Отдаёт полный ответ ассистента с таблицами — как финальная запись Pi. */
  replyView(messageId: string, text: string, tables?: ChatMessageView["tables"]): ChatMessageView {
    return {
      messageId: `${messageId}:reply`,
      role: "assistant",
      text,
      status: "done",
      ...(tables !== undefined ? { tables } : {}),
    };
  }

  emitDelta(messageId: string, text: string) {
    const message = this.messages.get(messageId);
    if (message) {
      message.text += text;
      message.status = "running";
    }
    this.emit({ kind: "delta", messageId, text });
  }

  /** Доставляет подписчикам полную запись (как финальная запись Pi). */
  upsert(message: ChatMessageView) {
    this.messages.set(message.messageId, message);
    this.emit({ kind: "upsert", message });
  }

  finishReply(messageId: string, text: string, result: WaitResult) {
    const replyId = `${messageId}:reply`;
    const finalStatus = result.status === "done" ? "done" : "unanswered";
    const reply = this.messages.get(replyId);
    if (reply) {
      reply.text = text;
      reply.status = finalStatus;
      if (result.reason !== undefined) reply.error = result.reason;
      if (result.tables !== undefined) reply.tables = result.tables;
    }
    // Статус операции живёт на пользовательском сообщении — его смотрит панель.
    this.setStatus(messageId, finalStatus, result.reason);
    const usage = this.usageByOperation.get(messageId);
    this.waits.get(messageId)?.resolve({
      ...result,
      ...(usage !== undefined && result.status === "done" ? { usage } : {}),
    });
    this.waits.delete(messageId);
  }

  failRun(messageId: string, reason: string) {
    this.setStatus(messageId, "failed", reason);
    this.waits.get(messageId)?.resolve({ status: "unanswered", reason });
    this.waits.delete(messageId);
  }

  private setStatus(messageId: string, status: ChatMessageStatus, error?: string) {
    const message = this.messages.get(messageId);
    if (!message) return;
    message.status = status;
    if (error !== undefined) message.error = error;
    this.emit({ kind: "status", messageId, status, error });
  }

  private emit(update: RuntimeUpdate) {
    for (const listener of this.listeners) listener(update);
  }
}
