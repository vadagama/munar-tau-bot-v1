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
import { createRegistry, Harness, type EntryRecord, type Registry, type ReportInfo } from "@earendil-works/pi-durable";
import { PiHarness, type PiPendingOperation } from "agents/harness/pi";
import type { ChatRuntime, OperationUsage, RuntimeListener, RuntimeUpdate, SubmitResult, WaitResult } from "./chat-runtime.ts";
import type { ChatMessageView } from "./protocol.ts";
import { describeFailure } from "./failure-text.ts";
import { contentText, collectSources, sourcesForEntry } from "./tools/sources.ts";
import { tablesForEntry } from "./tools/tables.ts";
import { EntityApiClient } from "./tools/api-client.ts";
import { createEntityExtension } from "./tools/guard.ts";

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
  /** GET /v1-ресурса с Bearer JWT (путь начинается с /v1/…) — инструменты
   *  сущностей S2.1 (ADR-021: данные только через API под PDP). */
  fetchApi: (path: string, jwt: string) => Promise<Response>;
  now?: () => Date;
}

/** Модель по умолчанию, если model_id из настроек не найден в каталоге pi-ai. */
const FALLBACK_MODEL_ID = "deepseek-flash";

const PROVIDER_ID = "deepseek";

function entryText(content: unknown): string {
  return contentText(content);
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
  /** Ключ провайдера в памяти изолята; null — ещё не получен (отказ не кэшируется). */
  private apiKey: string | null = null;
  private modelId: string | null = null;
  private baseUrl: string | null = null;
  private modelSet = false;
  private listeners = new Set<RuntimeListener>();
  private eventStreamStarted = false;
  /** operationId последнего submit — атрибуция дельт стриминга (один пользователь на DO). */
  private liveOperationId: string | null = null;
  /**
   * Границы операций (S3.1): operationId → id последней записи транскрипта на
   * момент submit. Расход операции — assistant-записи между её границей и
   * границей следующей операции (Pi исполняет операции последовательно).
   */
  private readonly marks = new Map<string, number | null>();

  constructor(private readonly deps: PiRuntimeDeps) {
    this.registry = createRegistry();
    // Read-only реестр инструментов сущностей и агрегатов + guard beforeTool
    // (S2.1/S4a.2): модель видит только инструменты белого списка, всё прочее
    // блокируется хуком.
    this.registry.install(
      createEntityExtension(
        new EntityApiClient({
          getAccessToken: deps.getAccessToken,
          fetchApi: deps.fetchApi,
        }),
      ),
    );
    this.harness = new PiHarness({
      harness: ({ storage, context, onWake }) => {
        const models = createModels();
        models.setProvider(this.buildProvider());
        this.models = models;
        return Harness.open(storage, {
          models,
          registry: this.registry,
          onWake,
          onReport: (error, info) => this.onReport(error, info),
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
    if (receipt.accepted) {
      // Граница расхода операции: записи, появившиеся после этого момента,
      // принадлежат ей (следующая операция отсекает окно).
      const entries = await this.harness.messages();
      this.marks.set(input.messageId, entries.length > 0 ? Number(entries.at(-1)!.id) : null);
    }
    return { accepted: receipt.accepted };
  }

  async wait(messageId: string): Promise<WaitResult> {
    const result = await this.harness.wait(messageId);
    if (result.status !== "done") {
      // Развёрнутый сбой вместо сырой причины Pi (no_model и т.п.): владелец
      // видит, что случилось и что делать (решение 26.10.2026).
      return {
        status: result.status,
        text: result.text,
        reason: describeFailure({ apiKeyPresent: this.apiKey !== null, reason: result.reason }),
      };
    }
    // Пул источников — из tool-result записей транскрипта (S2.1), таблицы —
    // только из операции этого ответа: tool-результаты после предыдущего ответа
    // ассистента (S4a.2; инцидент 26.10.2026: таблица старого отчёта прилипала
    // ко всем последующим ответам сессии). Пустые пулы не отправляем.
    const entries = await this.harness.messages();
    const sources = collectSources(entries);
    const lastAssistant = [...entries].reverse().find(isAssistantEntry);
    const tables = lastAssistant === undefined ? [] : tablesForEntry(entries, Number(lastAssistant.id));
    // Расход ответа (S3.1): undefined уходит из JSON — POST usage не вызывается.
    const usage = await this.operationUsage(messageId);
    return {
      status: result.status,
      text: result.text,
      reason: result.reason,
      ...(sources.length > 0 ? { sources } : {}),
      ...(tables.length > 0 ? { tables } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };
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
      if (view === null) continue;
      if (isAssistantEntry(entry)) {
        // Источники — накопленный пул до ответа (S2.1), таблицы — только из
        // операции этого ответа (tablesForEntry отсекает прошлые операции):
        // снапшот после переподключения несёт то же, что и живой ответ.
        const sources = sourcesForEntry(entries, entry.id);
        if (sources.length > 0) view.sources = sources;
        const tables = tablesForEntry(entries, entry.id);
        if (tables.length > 0) view.tables = tables;
      }
      views.push(view);
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

  /**
   * Закрыть in-memory ресурсы Pi перед стиранием storage (retention S6.1);
   * durable-состояние Pi не трогается — его стирает DO через deleteAll.
   */
  async dispose(): Promise<void> {
    await this.harness.dispose();
  }

  /**
   * Расход операции (S3.1): сумма usage assistant-записей между границей
   * submit и границей следующей операции. prompt = input + cacheRead +
   * cacheWrite (семантика prompt_tokens провайдера), completion = output.
   * undefined — операция без принятого submit (границы нет).
   */
  private async operationUsage(operationId: string): Promise<OperationUsage | undefined> {
    const mark = this.marks.get(operationId);
    if (mark === undefined) return undefined;
    const markNum = mark ?? -1;
    let nextMark: number | null = null;
    for (const [op, boundary] of this.marks) {
      const boundaryNum = boundary ?? -1;
      if (op !== operationId && boundaryNum > markNum && (nextMark === null || boundaryNum < nextMark)) {
        nextMark = boundaryNum;
      }
    }
    const entries = await this.harness.messages();
    let promptTokens = 0;
    let completionTokens = 0;
    for (const entry of entries) {
      if (!isAssistantEntry(entry)) continue;
      const id = Number(entry.id);
      if (id <= markNum || (nextMark !== null && id >= nextMark)) continue;
      const message = entry.model?.[0];
      if (message?.role === "assistant" && message.usage) {
        promptTokens += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
        completionTokens += message.usage.output;
      }
    }
    return { promptTokens, completionTokens };
  }

  /** Модель сессии: model_id из настроек, при отсутствии в каталоге — дефолт. */
  private async ensureModel(): Promise<void> {
    if (this.modelSet) return;
    const token = await this.ensureRuntimeToken();
    // Ключа нет — модель не назначаем и modelSet не ставим: после починки
    // конфига применится настроенный model_id, а не дефолт.
    if (token === null) return;
    const candidates = getBuiltinModels(PROVIDER_ID);
    const requested = token.model_id ?? null;
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

  /**
   * Ключ провайдера: успешный ответ кэшируется в памяти изолята, отказ — нет
   * (ретрай при следующем submit — после починки конфига повтор срабатывает).
   * До auth гейта (холодный подъём изолята) ключа нет — модели уйдут
   * unanswered, очередь сохранится (afterFailedRun: keep).
   */
  private async ensureRuntimeToken(): Promise<RuntimeTokenResponse | null> {
    if (this.apiKey !== null) {
      return { provider: PROVIDER_ID, base_url: this.baseUrl, model_id: this.modelId, api_key: this.apiKey };
    }
    const jwt = this.deps.getAccessToken();
    if (jwt === undefined) return null;
    const token = await this.deps.fetchRuntimeToken(jwt);
    if (token === null) return null;
    this.apiKey = token.api_key;
    this.baseUrl = token.base_url ?? null;
    this.modelId = token.model_id ?? null;
    return token;
  }

  /**
   * Отчёты Pi о нештатных состояниях задач (S6.1): parked доставляется
   * пользователю как статус (кнопка «Повторить» уже в панели), сбои — только
   * в structured log. Текст ошибки наружу не идёт — может содержать данные
   * запроса; в лог идёт тип отчёта и kind задачи, без персональных данных.
   */
  private onReport(_error: unknown, info: ReportInfo): void {
    const taskKind = "task" in info && info.task !== undefined ? info.task.kind : null;
    console.log(JSON.stringify({ event: "assistant_pi_report", type: info.type, ...(taskKind !== null ? { task: taskKind } : {}) }));
    if (info.type === "task_parked" && this.liveOperationId !== null) {
      const update: RuntimeUpdate = { kind: "status", messageId: this.liveOperationId, status: "parked" };
      for (const listener of this.listeners) listener(update);
    }
  }

  /** Поток событий Pi: только дельты живого ответа. Апсеты записей
   *  (message_end/entry_appended) не транслируются: их id не совпадает с
   *  operationId, панель дублировала вопрос и ответ; финальный текст приходит
   *  через wait()→done. */
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
          }
        }
      });
    } catch {
      // Поток событий не критичен: финальный текст приходит через wait()→done.
      this.eventStreamStarted = false;
    }
  }
}
