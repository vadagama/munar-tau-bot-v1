// Коды ошибок и формат тела — LLD-03, раздел 1.1.
// HTTP-статусы для кодов, не зафиксированных в LLD явно, выбраны по смыслу и
// закомментированы; при уточнении контракта правится только эта таблица.

/** Коды ошибок API (LLD-03 §1.1). */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "NO_PROFILE"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "PRIVILEGED_REQUIRED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "CONCURRENT_MODIFICATION"
  | "IDEMPOTENCY_CONFLICT"
  | "FILE_LIMIT"
  | "RULE_LEGAL_BOUNDARY"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  NO_PROFILE: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  PRIVILEGED_REQUIRED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INVALID_TRANSITION: 409,
  CONCURRENT_MODIFICATION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FILE_LIMIT: 413,
  RULE_LEGAL_BOUNDARY: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Тело ошибки по контракту LLD-03 §1.1. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
    readonly trace_id: string;
  };
}

/** Ошибка домена/транспорта с кодом из реестра API. */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;
  public readonly traceId: string;

  public constructor(
    code: ApiErrorCode,
    message?: string,
    details?: unknown,
    traceId?: string,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.traceId = traceId ?? crypto.randomUUID();
  }

  /** HTTP-статус, соответствующий коду. */
  public get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  /** Тело ответа в формате LLD-03 §1.1. */
  public toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        trace_id: this.traceId,
      },
    };
  }
}

const MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  UNAUTHENTICATED: "Требуется аутентификация",
  NO_PROFILE: "Профиль не найден для аутентифицированного пользователя",
  SESSION_EXPIRED: "Сеанс истёк",
  FORBIDDEN: "Недостаточно полномочий",
  PRIVILEGED_REQUIRED: "Действие доступно только через кабинет с подтверждением",
  NOT_FOUND: "Объект не найден",
  VALIDATION_FAILED: "Данные не прошли валидацию",
  INVALID_TRANSITION: "Недопустимый переход для текущего состояния",
  CONCURRENT_MODIFICATION: "Объект изменён другим участником",
  IDEMPOTENCY_CONFLICT: "Ключ идемпотентности уже использован с другим телом",
  FILE_LIMIT: "Файл превышает допустимые размер или формат",
  RULE_LEGAL_BOUNDARY: "Значение выходит за границы правового правила",
  RATE_LIMITED: "Превышен лимит запросов",
  INTERNAL: "Внутренняя ошибка сервера",
};

/** Дефолтные сообщения по кодам — для слоёв подачи (бот отличает свой текст от дефолтного). */
export const ERROR_MESSAGES = MESSAGES;

/**
 * Маппинг произвольной ошибки в ответ API.
 * Неизвестные ошибки не раскрывают деталей — только 500 INTERNAL и trace_id.
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ApiErrorBody;
} {
  if (error instanceof ApiError) {
    return { status: error.status, body: error.toBody() };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL",
        message: MESSAGES.INTERNAL,
        trace_id: crypto.randomUUID(),
      },
    },
  };
}
