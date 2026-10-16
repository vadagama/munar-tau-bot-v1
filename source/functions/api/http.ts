// Транспортные помощники api: единый формат ответов JSON с no-store
// (LLD-03 §1.2), CORS для кабинета на Cloudflare Pages (ADR-002, план VS-1)
// и чтение JSON-тела запроса.

import { ApiError, toErrorResponse } from "../../core/src/errors/api.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Заголовки CORS для разрешённого origin; без origin — пусто (не браузер). */
export function corsHeaders(request: Request, cabinetOrigin: string | undefined): Record<string, string> {
  const origin = request.headers.get("origin");
  if (origin === null) return {};
  // Dev-удобство: без CABINET_ORIGIN разрешаем localhost (план VS-1, CORS).
  const allowed = cabinetOrigin !== undefined ? origin === cabinetOrigin : isLocalhost(origin);
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, idempotency-key",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function isLocalhost(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Preflight: 204 с CORS-заголовками (разрешённым origin — эхо). */
export function preflightResponse(request: Request, cabinetOrigin: string | undefined): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, cabinetOrigin) });
}

/** Успешный ответ: JSON + no-store + CORS (LLD-03 §1.2). */
export function jsonResponse(
  request: Request,
  cabinetOrigin: string | undefined,
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": "no-store",
      ...corsHeaders(request, cabinetOrigin),
    },
  });
}

/** Ответ ошибки в формате LLD-03 §1.1 + no-store + CORS. */
export function errorResponse(
  request: Request,
  cabinetOrigin: string | undefined,
  error: unknown,
): Response {
  const { status, body } = toErrorResponse(error);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": "no-store",
      ...corsHeaders(request, cabinetOrigin),
    },
  });
}

/** Чтение JSON-тела: отсутствует — пустой объект; битый JSON — VALIDATION_FAILED. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("не объект");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Тело запроса должно быть JSON-объектом");
  }
}

/** Строковое поле тела: строка ли и непустая. */
export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError("VALIDATION_FAILED", `Поле ${field} обязательно (непустая строка)`);
  }
  return value.trim();
}

/** Необязательное строковое поле. */
export function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_FAILED", `Поле ${field} должно быть строкой`);
  }
  return value;
}

/** Необязательное обнуляемое поле: undefined — не менять, null — снять. */
export function optionalNullableString(
  body: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = body[field];
  if (value === undefined || value === null) return value as string | null | undefined;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_FAILED", `Поле ${field} должно быть строкой или null`);
  }
  return value;
}

/** Необязательный массив строк (области домов, LLD-02 §2.6). */
export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError("VALIDATION_FAILED", `Поле ${field} должно быть массивом строк`);
  }
  return value as string[];
}

/** Логическое поле: undefined — не задано. */
export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError("VALIDATION_FAILED", `Поле ${field} должно быть логическим`);
  }
  return value;
}

/** Числовой параметр запроса с пределами (LLD-03 §1: максимум limit=100). */
export function limitParam(url: URL, defaultValue = 50): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ApiError("VALIDATION_FAILED", "Параметр limit — целое от 1 до 100");
  }
  return value;
}
