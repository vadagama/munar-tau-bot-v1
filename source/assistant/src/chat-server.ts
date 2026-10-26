// ChatServer — логика WS-сессии поверх ChatRuntime: auth-хендшейк, снапшот +
// дельты fan-out, submit с operationId (идемпотентность Pi), retry, resync.
// Финал операции (done) доставляется фоновым вейтером в defer — переживает
// потерю сокета и вытеснение изолята, переподписка — хендшейк/resync.
// Не знает ни о Workers API, ни о Pi: сокеты — интерфейс ChatSocket, рантайм —
// ChatRuntime. Тестируется на фейках (S1.1), DO (do.ts) только склеивает.

import type {
  ChatRuntime,
  OperationUsage,
  PendingOperation,
  RuntimeUpdate,
  WaitResult,
} from "./chat-runtime.ts";
import {
  encodeServerMessage,
  parseClientMessage,
  type AuthDecision,
  type ClientMessage,
  type ServerMessage,
  type SocketSession,
} from "./protocol.ts";

/** Минимальный контракт сокета: достаточно для fan-out без Workers API. */
export interface ChatSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface ChatServerDeps {
  runtime: ChatRuntime;
  /** Гейт первого сообщения: JWT + enabled + сверка профиля (gate.ts). */
  authenticate(jwt: string): Promise<AuthDecision>;
  /** Актуальна ли эпоха DO: "stale" — клиент должен переподключиться. */
  checkEpoch(): Promise<"ok" | "stale">;
  /** Гейт лимитов до submit (S3.1): "day"/"month" — отказ без вызова модели. */
  checkLimits(): Promise<"ok" | "day" | "month">;
  /**
   * Учёт расхода после ответа (S3.1): POST /v1/assistant/usage (идемпотентно
   * по operation_id). Fire-and-forget: ошибка учёта не ломает done.
   */
  onUsage(operationId: string, usage: OperationUsage): void;
  /**
   * Фоновые задачи переживают обработчик WS-сообщения (в DO — ctx.waitUntil):
   * вейтер done не должен умирать вместе с сокетом или обработчиком.
   */
  defer(promise: Promise<void>): void;
  now(): Date;
}

const WS_CLOSE_POLICY = 1008;

export class ChatServer {
  private readonly sockets = new Map<ChatSocket, SocketSession | null>();
  /** Активные вейтеры done: один на операцию — защита от дублей при resync. */
  private readonly waiters = new Map<string, Promise<void>>();
  private subscribed = false;

  constructor(private readonly deps: ChatServerDeps) {}

  onOpen(socket: ChatSocket): void {
    this.sockets.set(socket, null);
  }

  onClose(socket: ChatSocket): void {
    this.sockets.delete(socket);
  }

  /**
   * Сообщение сокета. session — состояние из serializeAttachment (после
   * пробуждения DO) или null до аутентификации. Возвращает сессию для
   * сохранения в сокете.
   */
  async onMessage(
    socket: ChatSocket,
    raw: string,
    session: SocketSession | null,
  ): Promise<SocketSession | null> {
    const message = parseClientMessage(raw);
    if (message === null) {
      this.send(socket, { type: "error", code: "rejected", message: "Нераспознанный формат сообщения" });
      socket.close(WS_CLOSE_POLICY, "invalid message");
      return session;
    }
    if (session === null) {
      return this.handleHandshake(socket, message);
    }
    this.sockets.set(socket, session);
    this.attachRuntimeListener();
    if ((await this.deps.checkEpoch()) === "stale") {
      this.send(socket, {
        type: "error",
        code: "epoch_stale",
        message: "Сессия очищена или начался новый день — подключитесь заново",
      });
      socket.close(WS_CLOSE_POLICY, "epoch stale");
      return null;
    }
    await this.handleAuthenticated(socket, message, session);
    return session;
  }

  /** Подписка на обновления рантайма; вызывается DO при пробуждении изолята. */
  attachRuntimeListener(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.deps.runtime.subscribe((update) => this.broadcast(update));
  }

  private async handleHandshake(socket: ChatSocket, message: ClientMessage): Promise<SocketSession | null> {
    if (message.type !== "auth") {
      this.send(socket, { type: "auth_error", reason: "Первое сообщение должно быть auth" });
      socket.close(WS_CLOSE_POLICY, "auth required");
      return null;
    }
    const decision = await this.deps.authenticate(message.jwt);
    if (!decision.ok || decision.profileId === undefined || decision.epoch === undefined) {
      this.send(socket, { type: "auth_error", reason: decision.reason ?? "Доступ запрещён" });
      socket.close(WS_CLOSE_POLICY, "auth failed");
      return null;
    }
    // Эпоха проверяется сразу после auth (S6.1): DO прошлой эпохи — после
    // «Очистить» или границы суток 05:00 — не отдаёт историю даже с валидным
    // JWT того же профиля. Клиент на epoch_stale переподключается к новой эпохе.
    if ((await this.deps.checkEpoch()) === "stale") {
      this.send(socket, {
        type: "error",
        code: "epoch_stale",
        message: "Сессия очищена или начался новый день — подключитесь заново",
      });
      socket.close(WS_CLOSE_POLICY, "epoch stale");
      return null;
    }
    const session: SocketSession = { profileId: decision.profileId, epoch: decision.epoch };
    this.sockets.set(socket, session);
    this.attachRuntimeListener();
    this.send(socket, { type: "auth_ok", profileId: session.profileId, epoch: session.epoch });
    await this.sendSnapshot(socket);
    await this.sendPendingStatuses(socket);
    return session;
  }

  private async handleAuthenticated(
    socket: ChatSocket,
    message: ClientMessage,
    session: SocketSession,
  ): Promise<void> {
    switch (message.type) {
      case "auth":
        // Повторный auth на живом сокете — безвреден, сессия уже есть.
        this.send(socket, { type: "auth_ok", profileId: session.profileId, epoch: session.epoch });
        return;
      case "message":
        await this.handleSubmit(socket, message.messageId, message.text);
        return;
      case "retry":
        await this.deps.runtime.retry(message.messageId);
        this.ensureWaiter(message.messageId);
        return;
      case "resync":
        await this.sendSnapshot(socket);
        await this.sendPendingStatuses(socket);
        return;
    }
  }

  private async handleSubmit(socket: ChatSocket, messageId: string, text: string): Promise<void> {
    // Гейт лимитов до submit (S3.1): превышение — отказ в панели без вызова
    // модели и без записи расхода.
    const limits = await this.deps.checkLimits();
    if (limits !== "ok") {
      this.send(socket, {
        type: "error",
        code: "limit_exceeded",
        messageId,
        message: limits === "day"
          ? "Дневной лимит токенов исчерпан — попробуйте после 05:00 или попросите повысить лимит в настройках"
          : "Месячный лимит токенов исчерпан — доступ возобновится в следующем месяце или после повышения лимита",
      });
      return;
    }
    const { accepted } = await this.deps.runtime.submit({ messageId, text });
    if (!accepted) {
      // Дубликат operationId: новых сообщений не создаём, возвращаем состояние.
      const existing = (await this.deps.runtime.transcript()).find((m) => m.messageId === messageId);
      if (existing) {
        this.send(socket, { type: "status", messageId, status: existing.status, error: existing.error });
      } else {
        this.send(socket, { type: "error", code: "rejected", message: "Повтор не принят", messageId });
      }
      return;
    }
    this.send(socket, { type: "status", messageId, status: "queued" });
    // Вейтер — в defer (DO: ctx.waitUntil): ответ доходит, даже если сокет или
    // обработчик WS-сообщения умрут до завершения операции.
    this.ensureWaiter(messageId);
  }

  /** Статусы незавершённых операций + переподписка на их завершение. */
  private async sendPendingStatuses(socket: ChatSocket): Promise<void> {
    // Статусы незавершённых операций (S6.1): снапшот помечает пользовательские
    // записи «done», без этого parked/queued после переподключения не видны и
    // кнопка «Повторить» недоступна.
    for (const operation of await this.deps.runtime.pending()) {
      this.send(socket, { type: "status", messageId: operation.messageId, status: operation.status });
      this.ensureWaiter(operation.messageId, operation.status);
    }
  }

  /**
   * Гарантирует ровно один вейтер завершения операции (инцидент 26.10.2026:
   * вейтер жил в обработчике WS-сообщения и умирал вместе с сокетом или
   * вытесненным изолятом — панель оставалась в busy навсегда). Живёт в defer,
   * done рассылается всем аутентифицированным сокетам; восстановление после
   * потери — хендшейк нового изолята или resync через sendPendingStatuses.
   * Parked не вейтерится: операция ждёт ручного «Повторить», вечный waitUntil
   * не давал бы DO уснуть.
   */
  private ensureWaiter(messageId: string, status?: PendingOperation["status"]): void {
    if (status === "parked" || this.waiters.has(messageId)) return;
    const waiter = (async () => {
      try {
        const result = await this.deps.runtime.wait(messageId);
        this.deliverDone(messageId, result);
      } catch {
        // Потерянная операция восстановится resync-ом или хендшейком нового
        // изолята — глотать ошибку здесь безопаснее, чем ронять фоновую задачу.
      } finally {
        this.waiters.delete(messageId);
      }
    })();
    this.waiters.set(messageId, waiter);
    this.deps.defer(waiter);
  }

  /** Финал операции — всем аутентифицированным сокетам, затем учёт расхода. */
  private deliverDone(messageId: string, result: WaitResult): void {
    for (const [socket, session] of this.sockets) {
      if (session === null) continue;
      this.send(socket, {
        type: "done",
        messageId,
        status: result.status,
        text: result.text,
        error: result.reason,
        // Пул карточек-ссылок из инструментов (S2.1); undefined уходит из JSON.
        sources: result.sources,
        // Таблицы агрегатов из инструментов (S4a.2); undefined уходит из JSON.
        tables: result.tables,
      });
    }
    // Учёт расхода после ответа (S3.1): POST идемпотентен по operation_id.
    // done уже ушёл — сбой учёта клиенту не виден.
    if (result.usage !== undefined) {
      try {
        this.deps.onUsage(messageId, result.usage);
      } catch {
        // Учёт не должен ломать сессию.
      }
    }
  }

  private async sendSnapshot(socket: ChatSocket): Promise<void> {
    this.send(socket, { type: "snapshot", messages: await this.deps.runtime.transcript() });
  }

  private broadcast(update: RuntimeUpdate): void {
    for (const [socket, session] of this.sockets) {
      if (session === null) continue;
      if (update.kind === "delta") {
        this.send(socket, { type: "delta", messageId: update.messageId, text: update.text });
      } else if (update.kind === "upsert") {
        this.send(socket, { type: "upsert", message: update.message });
      } else {
        this.send(socket, {
          type: "status",
          messageId: update.messageId,
          status: update.status,
          error: update.error,
        });
      }
    }
  }

  /** Отправка с тихим проглатыванием ошибок: сокет может закрыться между ветками. */
  private send(socket: ChatSocket, message: ServerMessage): void {
    try {
      socket.send(encodeServerMessage(message));
    } catch {
      // Отвалившийся сокет: fan-out не должен ломать остальные подключения.
    }
  }
}
