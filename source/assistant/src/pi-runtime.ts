// Реализация ChatRuntime на Pi Durable (PiHarness) — S1.1/S1.3. Тонкая склейка:
// юнит-тестов нет (только typecheck), вся логика чата покрыта тестами ChatServer
// на фейке. Ключ провайдера приходит по POST /v1/assistant/runtime-token с JWT
// пользователя (ADR-021), держится только в памяти изолята — ни в pi_*,
// ни в логах; resolve авторизации вызывается лениво, при запросе модели.
//
// Lifecycle монополизирует alarm() DO (доки agents 0.30.x), поэтому «память
// 05:00→05:00» реализована не будильником, а эпохами: DO на сутки/очистку —
// `assistant:<profile_id>:<epoch>` (almaty.ts), новую эпоху панель получает
// через POST /v1/assistant/clear. Отклонение зафиксировано в реестре задач.

import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { createModels, type Provider } from "@earendil-works/pi-ai/models";
import type { Model } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type EntryRecord, type Registry } from "@earendil-works/pi-durable";
import { PiHarness, type PiPendingOperation } from "agents/harness/pi";
import type { ChatRuntime, RuntimeListener, RuntimeUpdate, SubmitResult, WaitResult } from "./chat-runtime.ts";
import type { ChatMessageView } from "./protocol.ts";

/** Ответ POST /v1/assistant/runtime-token (S0.3, core/src/domains/assistant). */
export interface RuntimeTokenResponse {
  provider: string;
  base_url: string | null;
  model_id: string | null;
  api_key: string;
}

export interface PiRuntimeDeps {
  ctx: DurableObjectState;
  /** JWT пользователя текущего сеанса (после auth гейта); до auth — undefined. */
  getAccessToken: () => string | undefined;
  /** Вызов POST /v1/assistant/runtime-token с Bearer JWT (инъекция для тестов типа). */
  fetchRuntimeToken: (jwt: string) => Promise<RuntimeTokenResponse | null>;
  now?: () => Date;
}

/** Модель по умолчанию, если model_id из настроек не найден в каталоге pi-ai. */
const FALLBACK_MODEL_ID = "deepseek-flash";

const PROVIDER_ID = "deepseek";

function entryText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

function isAssistantEntry(entry: EntryRecord): boolean {
  return entry.kind === "pi.assistant";
}

function isUserEntry(entry: EntryRecord): boolean {
  return entry.kind === "pi.user";
}

/** Складывает записи транскрипта Pi в вид панели: вопросы и ответы. */
function foldEntry(entry: EntryRecord): ChatMessageView | null {
  const message = entry.model?.[0];
  if (!message) return null;
  if (isUserEntry(entry)) {
    return { messageId: String(entry.id), role: "user", text: entryText(message.content), status: "done" };
  }
  if (isAssistantEntry(entry)) {
    return { messageId: String(entry.id), role: "assistant", text: entryText(message.content), status: "done" };
  }
  return null;
}

function mapStatus(status: PiPendingOperation["status"]): "queued" | "running" | "parked" {
  return status;
}

export class PiChatRuntime implements ChatRuntime {
  private readonly harness: PiHarness;
  private readonly registry: Registry;
  private models: ReturnType<typeof createModels> | null = null;
  /** Ключ провайдера в памяти изолята; NaN — ещё не запрашивали. */
  private apiKey: string | null = null;
  private apiKeyRequested = false;
  private modelId: string | null = null;
  private baseUrl: string | null = null;
  private modelSet = false;
  private listeners = new Set<RuntimeListener>();
  private eventStreamStarted = false;
  /** operationId последнего submit — атрибуция дельт стриминга (один пользователь на DO). */
  private liveOperationId: string | null = null;

  constructor(private readonly deps: PiRuntimeDeps) {
    this.registry = createRegistry();
    this.harness = new PiHarness({
      harness: ({ storage, context, onWake }) => {
        const models = createModels();
        models.setProvider(this.buildProvider());
        this.models = models;
        return Harness.open(storage, {
          models,
          registry: this.registry,
          onWake,
          settings: {
            retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
            afterFailedRun: "keep",
          },
        }, context);
      },
    });
  }

  /** Capabilities для Lifecycle.install(host).use(...). */
  get capability(): PiHarness {
    return this.harness;
  }

  async submit(input: { messageId: string; text: string }): Promise<SubmitResult> {
    await this.ensureModel();
    this.liveOperationId = input.messageId;
    const receipt = await this.harness.submit(input.text, { operationId: input.messageId });
    return { accepted: receipt.accepted };
  }

  async wait(messageId: string): Promise<WaitResult> {
    const result = await this.harness.wait(messageId);
    return { status: result.status, text: result.text, reason: result.reason };
  }

  async pending() {
    return (await this.harness.pending()).map((operation) => ({
      messageId: operation.operationId,
      status: mapStatus(operation.status),
    }));
  }

  async transcript(): Promise<ChatMessageView[]> {
    const entries = await this.harness.messages();
    const views: ChatMessageView[] = [];
    for (const entry of entries) {
      const view = foldEntry(entry);
      if (view !== null) views.push(view);
    }
    return views;
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    void this.startEventStream();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async retry(_messageId: string): Promise<void> {
    // session.retry() перезапускает задачи, запаркованные crash-loop guard;
    // идентификатор операции не нужен — паркуются в рамках сессии.
    await this.harness.session().retry();
  }

  async reset(): Promise<void> {
    await this.harness.session().reset();
  }

  /** Модель сессии: model_id из настроек, при отсутствии в каталоге — дефолт. */
  private async ensureModel(): Promise<void> {
    if (this.modelSet) return;
    const token = await this.ensureRuntimeToken();
    const candidates = getBuiltinModels(PROVIDER_ID);
    const requested = token?.model_id ?? null;
    const model: Model<"openai-completions"> | undefined = requested !== null
      ? candidates.find((candidate) => candidate.id === requested)
      : undefined;
    const resolved = model ?? candidates.find((candidate) => candidate.id === FALLBACK_MODEL_ID) ?? candidates[0];
    if (resolved) {
      await this.harness.session().setModel({ provider: PROVIDER_ID, id: resolved.id });
    }
    this.modelSet = true;
  }

  /** Провайдер DeepSeek с ленивым resolve ключа (память изолята, не env). */
  private buildProvider(): Provider {
    const base = deepseekProvider();
    const baseAuth = base.auth.apiKey;
    if (!baseAuth) {
      throw new Error("Провайдер DeepSeek без apiKey-авторизации");
    }
    return {
      ...base,
      auth: {
        apiKey: {
          name: baseAuth.name,
          resolve: async () => {
            const apiKey = await this.ensureApiKey();
            if (apiKey === null) return undefined;
            return { auth: { apiKey, baseUrl: this.baseUrl ?? undefined } };
          },
        },
      },
    };
  }

  /**
   * Ключ провайдера: один запрос runtime-token на изолят, кэш в памяти.
   * До auth гейта (холодный подъём изолята) ключа нет — модели уйдут
   * unanswered с no_model, очередь сохранится (afterFailedRun: keep).
   */
  private async ensureApiKey(): Promise<string | null> {
    const token = await this.ensureRuntimeToken();
    return token?.api_key ?? null;
  }

  private async ensureRuntimeToken(): Promise<RuntimeTokenResponse | null> {
    if (this.apiKeyRequested) {
      return this.apiKey === null
        ? null
        : { provider: PROVIDER_ID, base_url: this.baseUrl, model_id: this.modelId, api_key: this.apiKey };
    }
    this.apiKeyRequested = true;
    const jwt = this.deps.getAccessToken();
    if (jwt === undefined) return null;
    const token = await this.deps.fetchRuntimeToken(jwt);
    if (token === null) return null;
    this.apiKey = token.api_key;
    this.baseUrl = token.base_url ?? null;
    this.modelId = token.model_id ?? null;
    return token;
  }

  /** Поток событий Pi: дельты живого ответа и апсеты записей транскрипта. */
  private async startEventStream(): Promise<void> {
    if (this.eventStreamStarted) return;
    this.eventStreamStarted = true;
    try {
      const stream = await this.harness.session().events();
      const emit = (update: RuntimeUpdate) => {
        for (const listener of this.listeners) listener(update);
      };
      await stream.start(async (events) => {
        for (const event of events) {
          if (event.type === "message_update") {
            for (const change of event.changes) {
              if (change.type === "text_delta" && this.liveOperationId !== null) {
                emit({ kind: "delta", messageId: `${this.liveOperationId}:reply`, text: change.delta });
              }
            }
          } else if (event.type === "message_end" || event.type === "entry_appended") {
            const view = foldEntry(event.entry);
            if (view !== null) emit({ kind: "upsert", message: view });
          }
        }
      });
    } catch {
      // Поток событий не критичен: финальный текст приходит через wait()→done.
      this.eventStreamStarted = false;
    }
  }
}
