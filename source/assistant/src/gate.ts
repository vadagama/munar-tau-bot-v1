// Гейт AssistantDO (план S1.3): JWT Supabase (ES256 по SUPABASE_JWKS — реюз
// core/src/auth/jwt.ts) + enabled-флаг через GET /v1/assistant/settings/me
// с JWT самого пользователя (ADR-021: доступ к данным — только через API /v1,
// PDP на стороне API). Ответ кэшируется ≤ 60 с; до принятия сообщения DO
// вызывает checkEpoch, который ловит и выключение, и новую эпоху (очистка или
// наступивший день 05:00).
//
// Эмуляция (ADR-021, условие 3): эмулированный сеанс не должен открывать
// панель — гейт кабинета (admin/src/assistant) не подключается при
// identity.me.person.is_test; server-side ассистент всегда видит JWT
// реального пользователя.

import { buildJwtKeys, verifyJwt, type JwtVerifyKey } from "../../core/src/auth/jwt.ts";
import { effectiveEpoch } from "./almaty.ts";
import type { AuthDecision } from "./protocol.ts";

/** Вид ответа GET /v1/assistant/settings/me (S0 + поля эпохи из S1.3). */
export interface AssistantAccessResponse {
  enabled: boolean;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  day_used: number;
  month_used: number;
  day: string;
  month: string;
  /** Добавляется задачей эпох (S1.3, commit 5): владелец настроек. */
  profile_id?: string;
  /** Добавляется задачей эпох: конфиг-эпоха владельца. */
  epoch?: number;
}

const ACCESS_CACHE_TTL_MS = 60_000;
/** Таймаут похода в settings/me: зависший API не должен держать auth хендшейка. */
const ACCESS_FETCH_TIMEOUT_MS = 10_000;

export interface GateEnv {
  SUPABASE_JWKS?: string;
  SUPABASE_URL?: string;
}

interface CachedAccess {
  sub: string;
  jwt: string;
  view: AssistantAccessResponse;
  fetchedAt: number;
}

export interface GateDeps {
  env: GateEnv;
  /** Инъекция fetch для тестов; в рантайме — глобальный fetch Workers. */
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export class AssistantGate {
  private readonly env: GateEnv;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private keys: Promise<JwtVerifyKey[]> | null = null;
  private cached: CachedAccess | null = null;

  constructor(deps: GateDeps) {
    this.env = deps.env;
    this.fetchFn = deps.fetchFn ?? fetch.bind(globalThis);
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Проверка первого сообщения WS: подпись и срок JWT, enabled-флаг, сверка
   * профиля с владельцем DO. Решение кэшируется вместе с access-ответом.
   */
  async authenticate(jwt: string, expectedProfileId: string, expectedEpoch: number): Promise<AuthDecision> {
    let claims;
    try {
      claims = await verifyJwt(jwt, await this.getKeys(), this.now());
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Токен не принят" };
    }

    const view = await this.loadAccess(claims.sub, jwt);
    if (view === null) {
      return { ok: false, reason: "Не удалось подтвердить доступ ассистента" };
    }
    if (!view.enabled) {
      return { ok: false, reason: "Ассистент выключен для этого сотрудника" };
    }
    if (view.profile_id !== undefined && view.profile_id !== expectedProfileId) {
      // JWT не владельца DO: профиль токена не совпал с профилем изолята.
      return { ok: false, reason: "Токен принадлежит другому профилю" };
    }
    return { ok: true, profileId: expectedProfileId, epoch: expectedEpoch };
  }

  /**
   * Гейт каждого сообщения (план S1.3: до принятия сообщения): выключение
   * сотрудника или новая эпоха (ручная очистка / наступивший день) делают
   * текущий DO недействительным — клиент переподключается к новой эпохе.
   */
  async checkEpoch(expectedProfileId: string, expectedEpoch: number): Promise<"ok" | "stale"> {
    const cached = this.cached;
    if (cached === null) return "stale";
    // Кэш ≤ 60 с: после истечения перечитываем settings/me тем же JWT.
    const view = await this.loadAccess(cached.sub, cached.jwt);
    if (view === null || !view.enabled) return "stale";
    if (view.profile_id !== undefined && view.profile_id !== expectedProfileId) {
      return "stale";
    }
    const configEpoch = view.epoch ?? 0;
    return effectiveEpoch(configEpoch, this.now()) === expectedEpoch ? "ok" : "stale";
  }

  /**
   * Гейт лимитов до submit (S3.1): расход против дневного/месячного лимита.
   * Вид access берётся из кэша (обновлён checkEpoch этим же сообщением и
   * инвалидацией после каждого POST usage); null-кэш сюда не доходит —
   * checkEpoch уже закрыл сокет. null-лимит — без ограничения.
   */
  async checkLimits(): Promise<"ok" | "day" | "month"> {
    const view = this.cached?.view;
    if (view === undefined) return "ok";
    if (view.daily_token_limit !== null && view.day_used >= view.daily_token_limit) return "day";
    if (view.monthly_token_limit !== null && view.month_used >= view.monthly_token_limit) return "month";
    return "ok";
  }

  /** Сброс кэша: при 401/403 от API или принудительном перепросмотре. */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * Свежий расход в кэш (S3.1): ответ POST usage несёт актуальные суммы дня и
   * месяца — следующий submit гейтит по ним без похода в API. Периоды не
   * совпали (наступил день/месяц) — кэш ждёт обычного протухания (≤ 60 с).
   */
  updateUsage(summary: { day: string; month: string; day_tokens: number; month_tokens: number }): void {
    const cached = this.cached;
    if (cached === null) return;
    if (cached.view.day === summary.day) cached.view.day_used = summary.day_tokens;
    if (cached.view.month === summary.month) cached.view.month_used = summary.month_tokens;
  }

  private async getKeys(): Promise<JwtVerifyKey[]> {
    this.keys ??= buildJwtKeys(this.requireJwks());
    return this.keys;
  }

  private requireJwks(): string {
    const raw = this.env.SUPABASE_JWKS;
    if (raw === undefined || raw === "") {
      throw new Error("Секрет SUPABASE_JWKS не настроен для Worker");
    }
    return raw;
  }

  private async loadAccess(sub: string, jwt: string): Promise<AssistantAccessResponse | null> {
    const cached = this.cached;
    const age = this.now().getTime() - (cached?.fetchedAt ?? 0);
    if (cached !== null && cached.sub === sub && age < ACCESS_CACHE_TTL_MS) {
      return cached.view;
    }
    const baseUrl = this.env.SUPABASE_URL;
    if (baseUrl === undefined || baseUrl === "") {
      throw new Error("Секрет SUPABASE_URL не настроен для Worker");
    }
    const url = `${baseUrl.replace(/\/$/, "")}/functions/v1/api/v1/assistant/settings/me`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { authorization: `Bearer ${jwt}` },
        // Зависший API не должен держать auth хендшейка дольше таймаута.
        signal: AbortSignal.timeout(ACCESS_FETCH_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (!response.ok) {
      // 401/403 — профиль не найден или нет права assistant.usage.read:
      // доступ не подтверждён, различия причин клиенту не раскрываем.
      return null;
    }
    const view = (await response.json()) as AssistantAccessResponse;
    this.cached = { sub, jwt, view, fetchedAt: this.now().getTime() };
    return view;
  }
}
