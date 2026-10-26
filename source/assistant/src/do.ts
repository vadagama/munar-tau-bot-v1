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
import { Lifecycle, type LifecycleJobContext, type LifecycleJobOutcome } from "agents/lifecycle";
import { ChatServer, type ChatSocket } from "./chat-server.ts";
import type { OperationUsage } from "./chat-runtime.ts";
import { AssistantGate } from "./gate.ts";
import { assistantDay, nextEpochBoundary, parseAssistantDoName } from "./almaty.ts";
import { PiChatRuntime, type RuntimeTokenResponse } from "./pi-runtime.ts";
import type { SocketSession } from "./protocol.ts";

export interface AssistantEnv {
  /** Durable Object namespace этого воркспейса. */
  ASSISTANT: DurableObjectNamespace;
  /** Секреты Worker (README воркспейса). */
  SUPABASE_URL?: string;
  SUPABASE_JWKS?: string;
  CABINET_ORIGIN?: string;
  /** Сервисный секрет учёта расхода (S3.1): POST /v1/assistant/usage. */
  X_ASSISTANT_SECRET?: string;
  /**
   * Сколько суток хранить историю прошлой эпохи (S6.1); по умолчанию 7.
   * Значение 7 — предложено, утвердить у владельца продукта.
   */
  ASSISTANT_RETENTION_DAYS?: string;
}

const WS_CLOSE_UNAUTHORIZED = 1008;
const WS_CLOSE_TEARDOWN = 1008;
const DEFAULT_RETENTION_DAYS = 7;

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
  /** Teardown-задача уже запланирована в этой жизни изолята. */
  private teardownScheduled = false;
  /** Стирание начато — повторные вызовы идемпотентно пропускаются. */
  private teardownStarted = false;

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
      fetchApi: (path, jwt) => this.fetchApi(path, jwt),
    });
    this.lifecycle = Lifecycle.install(this).use(this.runtime.capability);
  }

  /** Первый WS-запрос изолята: создание пары сокетов и ожидание auth. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    this.maintainTeardown();
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
    this.maintainTeardown();
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

  /**
   * Retention истории (S6.1): старая эпоха стирается teardown-задачей Lifecycle
   * на следующей границе суток 05:00 плюс ASSISTANT_RETENTION_DAYS (по умолчанию
   * 7); ленивый fallback страхует несработавшую задачу. История живёт в pi_*-
   * таблицах SQLite DO, поэтому стирание = deleteAll после dispose рантайма.
   */
  private maintainTeardown(): void {
    if (this.teardownStarted) return;
    if (this.epoch < assistantDay(new Date())) {
      // Эпоха уже прошла: Lifecycle-задача не успела (или не была запланирована).
      this.ctx.waitUntil(this.teardown("lazy"));
      return;
    }
    if (this.teardownScheduled) return;
    this.teardownScheduled = true;
    const time = nextEpochBoundary(new Date(), this.retentionDays());
    const pushed = this.lifecycle.jobs
      .push({ id: "teardown", fn: "teardownEpoch", time })
      .then(() => undefined)
      .catch(() => undefined);
    this.ctx.waitUntil(pushed);
  }

  /** Host-задачи Lifecycle: dispatch по fn (S6.1 — только teardownEpoch). */
  async onJob(context: LifecycleJobContext): Promise<LifecycleJobOutcome | void> {
    if (context.job.fn !== "teardownEpoch") return;
    const now = new Date();
    if (this.epoch >= assistantDay(now)) {
      // Эпоха ещё актуальна (например, конфиг-эпоха после «Очистить» далеко
      // впереди) — перепланировать на следующую границу + retention.
      return { rescheduleAt: nextEpochBoundary(now, this.retentionDays()) };
    }
    // Стирание — вне onJob: очередь задач пишет bookkeeping в тот же storage,
    // который deleteAll сотрёт из-под неё (Lifecycle требует detach).
    this.ctx.waitUntil(this.teardown("job"));
  }

  /**
   * Стирание истории старой эпохи: alarms отключаются до dispose (Pi не будит
   * изолят посреди стирания), затем storage deleteAll и закрытие сокетов.
   * Ошибки глотаются с structured log — повторный вызов безопасен.
   */
  private async teardown(trigger: "job" | "lazy"): Promise<void> {
    if (this.teardownStarted) return;
    this.teardownStarted = true;
    try {
      await this.lifecycle.disableAlarms();
      await this.runtime.dispose();
      await this.ctx.storage.deleteAll();
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(WS_CLOSE_TEARDOWN, "assistant history expired");
        } catch {
          // Сокет уже закрыт клиентом.
        }
      }
      console.log(JSON.stringify({ event: "assistant_teardown", profile: this.profileId, epoch: this.epoch, trigger }));
    } catch (error) {
      console.log(
        JSON.stringify({ event: "assistant_teardown_failed", profile: this.profileId, epoch: this.epoch, trigger, error: String(error) }),
      );
    }
  }

  /** Сутки хранения прошлой эпохи; невалидный env — дефолт (7). */
  private retentionDays(): number {
    const parsed = Number(this.env.ASSISTANT_RETENTION_DAYS);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_RETENTION_DAYS;
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
      // JWT сеанса сохраняется в памяти изолята только после успешного гейта:
      // runtime-token и инструменты сущностей берут его через getAccessToken.
      authenticate: async (jwt) => {
        const decision = await this.gate.authenticate(jwt, this.profileId, this.epoch);
        if (decision.ok) this.accessToken = jwt;
        return decision;
      },
      checkEpoch: () => this.gate.checkEpoch(this.profileId, this.epoch),
      checkLimits: () => this.gate.checkLimits(),
      onUsage: (operationId, usage) => this.reportUsage(operationId, usage),
      now: () => new Date(),
    });
  }

  /**
   * Учёт расхода после ответа (S3.1): POST /v1/assistant/usage с сервисным
   * секретом, идемпотентность по operation_id — повтор не удваивает. Свежие
   * суммы из ответа попадают в кэш гейта: следующий submit гейтит по ним.
   * waitUntil держит изолят живым до конца POST (ChatServer не ждёт).
   */
  private reportUsage(operationId: string, usage: OperationUsage): void {
    const baseUrl = this.env.SUPABASE_URL;
    const secret = this.env.X_ASSISTANT_SECRET;
    if (baseUrl === undefined || baseUrl === "" || secret === undefined || secret === "") {
      return;
    }
    const posted = fetch(`${baseUrl.replace(/\/$/, "")}/functions/v1/api/v1/assistant/usage`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-assistant-secret": secret },
      body: JSON.stringify({
        profile_id: this.profileId,
        operation_id: operationId,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
      }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        try {
          this.gate.updateUsage((await response.json()) as {
            day: string;
            month: string;
            day_tokens: number;
            month_tokens: number;
          });
        } catch {
          // Ответ не разобрался — гейт остаётся на кэше ≤ 60 с.
        }
      })
      .catch(() => {
        // Учёт best-effort: потерянная запись занижает расход, лимиты при этом
        // по-прежнему гейтятся по данным settings/me.
      });
    this.ctx.waitUntil(posted);
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

  /** GET /v1-ресурса с JWT пользователя — инструменты сущностей (S2.1).
   *  Не настроенный SUPABASE_URL — синтетический 503: инструменты честно
   *  ответят «сервис недоступен». */
  private fetchApi(path: string, jwt: string): Promise<Response> {
    const baseUrl = this.env.SUPABASE_URL;
    if (baseUrl === undefined || baseUrl === "") {
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    return fetch(`${baseUrl.replace(/\/$/, "")}/functions/v1/api${path}`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
  }
}
