// Проверка JWT Supabase Auth (ADR-001, LLD-03 §1). Платформа уже проверяет
// Bearer при verify_jwt = true; функция проверяет подпись сама — проверка
// полномочий всегда выполняется на сервере (AGENTS.md, границы).
//
// Важно: claim `role` внутри JWT НЕ источник полномочий (AGENTS.md:
// «редактируемые пользователем метаданные — не источник полномочий»);
// полномочия собирает PDP из БД.

import { ApiError } from "../errors/api.ts";

/** Полезная нагрузка JWT, используемая системой. */
export interface JwtClaims {
  /** Идентификатор пользователя Supabase Auth (ADR-001: sub ≠ telegram_user_id). */
  sub: string;
  /** Идентификатор сеанса Auth → access_session.id (LLD-02 §13). */
  sessionId: string | null;
  /** Срок токена (секунды с эпохи) — дублирует проверку платформы. */
  exp: number | null;
}

// Возвращаемый тип выводится: явная аннотация Uint8Array под новой lib TS
// (Deno) расширяется до ArrayBufferLike и не проходит по BufferSource.
function base64UrlToBytes(part: string) {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as Record<string, unknown>;
  } catch {
    throw new ApiError("UNAUTHENTICATED", "Некорректный формат токена");
  }
}

const encoder = new TextEncoder();

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * verifyJwt — проверка подписи HS256 и срока; возвращает проверенные claims.
 * Отсутствие секрета — ошибка конфигурации среды (ConfigError из requireEnv).
 */
export async function verifyJwt(token: string, secret: string, now: Date = new Date()): Promise<JwtClaims> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new ApiError("UNAUTHENTICATED", "Некорректный формат токена");
  }
  const header = decodeJsonPart(headerPart);
  if (header.alg !== "HS256") {
    throw new ApiError("UNAUTHENTICATED", "Неподдерживаемый алгоритм токена");
  }

  const key = await importHmacKey(secret);
  const signatureOk = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signaturePart),
    encoder.encode(`${headerPart}.${payloadPart}`),
  );
  if (!signatureOk) {
    throw new ApiError("UNAUTHENTICATED", "Подпись токена не совпала");
  }

  const payload = decodeJsonPart(payloadPart);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp !== null && exp * 1000 <= now.getTime()) {
    throw new ApiError("UNAUTHENTICATED", "Срок действия токена истёк");
  }
  const sub = payload.sub;
  if (typeof sub !== "string" || sub === "") {
    throw new ApiError("UNAUTHENTICATED", "В токене нет идентификатора пользователя");
  }
  const sessionId = typeof payload.session_id === "string" && payload.session_id !== ""
    ? payload.session_id
    : null;
  return { sub, sessionId, exp };
}
