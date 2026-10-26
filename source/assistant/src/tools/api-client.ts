// Клиент /v1 для инструментов сущностей (S2.1): только GET-чтение с JWT самого
// пользователя (ADR-021: доступ к данным — через API под PDP, у ассистента
// своего доступа к БД нет). fetch инъецируется из AssistantDO (SUPABASE_URL +
// актуальный JWT), в тестах — фейк. Язык профиля — /v1/meta/me, один запрос
// на изолят с кэшем в памяти.

export class ApiToolError extends Error {
  constructor(
    /** HTTP-статус; 0 — сетевой сбой, отказ до вызова или не-JSON ответ. */
    readonly status: number,
    /** Код ошибки LLD-03 §1.1 из тела ответа, если есть. */
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiToolError";
  }
}

export type Lang = "ru" | "kk";

export interface EntityApiClientDeps {
  getAccessToken: () => string | undefined;
  fetchApi: (path: string, jwt: string) => Promise<Response>;
}

export class EntityApiClient {
  private languageCache: Lang | null = null;

  constructor(private readonly deps: EntityApiClientDeps) {}

  /** GET /v1-ресурса: разобранный JSON или ApiToolError. */
  async get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const jwt = this.deps.getAccessToken();
    if (jwt === undefined) {
      throw new ApiToolError(0, null, "Нет действующего сеанса");
    }
    const pairs = Object.entries(params ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    const query = new URLSearchParams(pairs).toString();
    let response: Response;
    try {
      response = await this.deps.fetchApi(query === "" ? path : `${path}?${query}`, jwt);
    } catch {
      throw new ApiToolError(0, null, "Сервис данных недоступен");
    }
    if (!response.ok) {
      throw new ApiToolError(response.status, await errorCode(response), `HTTP ${response.status}`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiToolError(0, null, "Некорректный ответ сервиса данных");
    }
  }

  /** Язык профиля (ru/kk); недоступный meta/me не кэшируется — дефолт ru. */
  async language(): Promise<Lang> {
    if (this.languageCache !== null) return this.languageCache;
    try {
      const me = await this.get<{ profile?: { language?: unknown } }>("/v1/meta/me");
      this.languageCache = me.profile?.language === "kk" ? "kk" : "ru";
    } catch {
      return "ru";
    }
    return this.languageCache;
  }
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}
