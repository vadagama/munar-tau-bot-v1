// ChatServer — логика WS-сессии поверх ChatRuntime: auth-хендшейк, снапшот +
// дельты fan-out, submit с operationId (идемпотентность Pi), retry, resync.
// Не знает ни о Workers API, ни о Pi: сокеты — интерфейс ChatSocket, рантайм —
// ChatRuntime. Тестируется на фейках (S1.1), DO (do.ts) только склеивает.

import type { ChatRuntime, RuntimeUpdate } from "./chat-runtime.ts";
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
  now(): Date;
}

const WS_CLOSE_POLICY = 1008;

export class ChatServer {
  private readonly sockets = new Map<ChatSocket, SocketSession | null>();
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
    const session: SocketSession = { profileId: decision.profileId, epoch: decision.epoch };
    this.sockets.set(socket, session);
    this.attachRuntimeListener();
    this.send(socket, { type: "auth_ok", profileId: session.profileId, epoch: session.epoch });
    await this.sendSnapshot(socket);
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
        return;
      case "resync":
        await this.sendSnapshot(socket);
        return;
    }
  }

  private async handleSubmit(socket: ChatSocket, messageId: string, text: string): Promise<void> {
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
    const result = await this.deps.runtime.wait(messageId);
    this.send(socket, {
      type: "done",
      messageId,
      status: result.status,
      text: result.text,
      error: result.reason,
    });
  }

  private async sendSnapshot(socket: ChatSocket): Promise<void> {
    this.send(socket, { type: "snapshot", messages: await this.deps.runtime.transcript() });
  }

  private broadcast(update: RuntimeUpdate): void {
    for (const [socket, session] of this.sockets) {
      if (session === null) continue;
      if (update.kind === "delta") {
        this.send(socket, { type: "delta", messageId: update.messageId, text: update.text });
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
