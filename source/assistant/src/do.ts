// AssistantDO — один изолят на сотрудника и эпоху (имя assistant:<profile_id>:<epoch>,
// almaty.ts). Владеет hibernatable WebSocket: первое сообщение {type:"auth", jwt}
// проверяет гейт (gate.ts), дальше ChatServer ведёт сессию поверх ChatRuntime
// (PiChatRuntime на PiHarness). Состояние сокета — serializeAttachment, поэтому
// пробуждение изолята не требует повторного auth.
//
// Lifecycle монополизирует alarm/fetch/WebSocket-хендлеры изолята (доки agents
// 0.30.x): подписка на события Pi восстанавливается при первом сообщении после
// пробуждения (attachRuntimeListener), ключ провайдера перезапрашивается лениво.

import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { ChatServer, type ChatSocket } from "./chat-server.ts";
import { AssistantGate } from "./gate.ts";
import { parseAssistantDoName } from "./almaty.ts";
import { PiChatRuntime, type RuntimeTokenResponse } from "./pi-runtime.ts";
import type { SocketSession } from "./protocol.ts";

export interface AssistantEnv {
  /** Durable Object namespace этого воркспейса. */
  ASSISTANT: DurableObjectNamespace;
  /** Секреты Worker (README воркспейса). */
  SUPABASE_URL?: string;
  SUPABASE_JWKS?: string;
  CABINET_ORIGIN?: string;
}

const WS_CLOSE_UNAUTHORIZED = 1008;

/** Сокет DO поверх интерфейса ChatSocket (hibernatable send/close). */
class DoSocket implements ChatSocket {
  constructor(private readonly ws: WebSocket) {}

  send(data: string): void {
    this.ws.send(data);
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}

export class AssistantDO extends DurableObject<AssistantEnv> {
  private readonly lifecycle: Lifecycle<AssistantEnv>;
  private readonly profileId: string;
  private readonly epoch: number;
  private readonly gate: AssistantGate;
  private readonly runtime: PiChatRuntime;
  private server: ChatServer | null = null;
  private accessToken: string | undefined;

  constructor(ctx: DurableObjectState, env: AssistantEnv) {
    super(ctx, env);
    const name = parseAssistantDoName(ctx.id.name ?? "");
    if (name === null) {
      throw new Error(`AssistantDO создан с некорректным именем: ${ctx.id.name}`);
    }
    this.profileId = name.profileId;
    this.epoch = name.epoch;
    this.gate = new AssistantGate({ env });
    this.runtime = new PiChatRuntime({
      ctx,
      getAccessToken: () => this.accessToken,
      fetchRuntimeToken: (jwt) => this.fetchRuntimeToken(jwt),
    });
    this.lifecycle = Lifecycle.install(this).use(this.runtime.capability);
  }

  /** Первый WS-запрос изолята: создание пары сокетов и ожидание auth. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.ensureChatServer();
    this.server?.onOpen(new DoSocket(pair[1]));
    // Авторизация ограничена по времени: неаутентифицированный сокет закрывается.
    this.ctx.waitUntil(this.enforceAuthTimeout(pair[1]));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const session = this.readSession(ws);
    const socket = new DoSocket(ws);
    this.ensureChatServer();
    const server = this.server;
    if (server === null) return;
    const updated = await server.onMessage(socket, message, session);
    if (updated !== null && updated !== session) {
      ws.serializeAttachment(updated);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const socket = new DoSocket(ws);
    this.server?.onClose(socket);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    const socket = new DoSocket(ws);
    this.server?.onClose(socket);
  }

  /** Ждёт AUTH_TIMEOUT_MS и закрывает так и не аутентифицированный сокет. */
  private async enforceAuthTimeout(ws: WebSocket): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    if (this.readSession(ws) === null) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "auth timeout");
    }
  }

  private readSession(ws: WebSocket): SocketSession | null {
    try {
      return ws.deserializeAttachment() as SocketSession | null;
    } catch {
      return null;
    }
  }

  private ensureChatServer(): void {
    if (this.server !== null) {
      this.server.attachRuntimeListener();
      return;
    }
    this.server = new ChatServer({
      runtime: this.runtime,
      authenticate: (jwt) => this.gate.authenticate(jwt, this.profileId, this.epoch),
      checkEpoch: () => this.gate.checkEpoch(this.profileId, this.epoch),
      now: () => new Date(),
    });
  }

  /** Ключ провайдера — только в памяти изолята (ADR-021), вызов из pi-runtime. */
  private async fetchRuntimeToken(jwt: string): Promise<RuntimeTokenResponse | null> {
    const baseUrl = this.env.SUPABASE_URL;
    if (baseUrl === undefined || baseUrl === "") return null;
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/functions/v1/api/v1/assistant/runtime-token`,
        { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      );
      if (!response.ok) return null;
      return (await response.json()) as RuntimeTokenResponse;
    } catch {
      return null;
    }
  }
}
