// REST-клиент /v1 (LLD-03): Bearer-токен сессии Supabase, разбор ошибок
// формата LLD-03 §1.1, 401 от API — выход на /login (Task 6, критерий).

import { appEnv } from "./env";
import { getSupabase } from "./supabase";

/** Ошибка API с кодом из реестра LLD-03 §1.1. */
export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly traceId?: string;

  public constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
    traceId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.traceId = traceId;
  }
}

export interface ApiRequest {
  idempotencyKey?: string;
  file?: File;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function accessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (supabase === null) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** 401 от API — сеанс недействителен: выход на /login (Task 6). */
async function signOutAndRedirect(): Promise<void> {
  const supabase = getSupabase();
  await supabase?.auth.signOut();
  window.location.assign("/login");
}

export async function apiFetch<T>(path: string, request: ApiRequest = {}): Promise<T> {
  if (appEnv.apiUrl === null) {
    throw new ApiClientError(
      "CONFIG",
      "API не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY",
      0,
    );
  }
  const token = await accessToken();
  if (token === null) {
    throw new ApiClientError("UNAUTHENTICATED", "Нет активного сеанса", 401);
  }

  const url = new URL(appEnv.apiUrl + path);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  // Одна поездка браузер → регион БД вместо межрегионального SQL на каждом шаге.
  if (appEnv.functionRegion) {
    url.searchParams.set("forceFunctionRegion", appEnv.functionRegion);
  }

  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: {
      "authorization": `Bearer ${token}`,
      ...(request.file ? {"content-type":"application/octet-stream"} : request.body === undefined ? {} : { "content-type": "application/json" }),
      ...(request.idempotencyKey ? {"idempotency-key":request.idempotencyKey} : {}),
    },
    body: request.file ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
  });

  if (response.status === 401) {
    await signOutAndRedirect();
    throw new ApiClientError("UNAUTHENTICATED", "Сеанс истёк, выполните вход заново", 401);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)?.error;
    throw new ApiClientError(
      typeof error?.code === "string" ? error.code : "INTERNAL",
      typeof error?.message === "string" ? error.message : "Ошибка запроса",
      response.status,
      error?.details,
      typeof error?.trace_id === "string" ? error.trace_id : undefined,
    );
  }
  return payload as T;
}
