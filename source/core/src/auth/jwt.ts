// Проверка JWT Supabase Auth (ADR-001, LLD-03 §1). Платформа уже проверяет
// Bearer при verify_jwt = true; функция проверяет подпись сама — проверка
// полномочий всегда выполняется на сервере (AGENTS.md, границы).
//
// Подпись: Supabase Auth на новых проектах выпускает JWT с асимметричной
// подписью ES256 (ключи подписи, Management API /signing-keys). Публичные
// ключи приходят в Edge Function через SUPABASE_JWKS (инжектируется
// платформой; то же значение отдаёт auth/v1/.well-known/jwks.json).
// Симметричный legacy-секрет (HS256) платформой больше не используется.
//
// Важно: claim `role` внутри JWT НЕ источник полномочий (AGENTS.md:
// «редактируемые пользователем метаданные — не источник полномочий»);
// полномочия собирает PDP из БД.

import { ConfigError } from "../config/env.ts";
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

/** Подготовленный публичный ключ проверки подписи (из JWKS). */
export interface JwtVerifyKey {
  /** Идентификатор ключа (kid заголовка токена); null — ключ без kid. */
  readonly kid: string | null;
  readonly key: CryptoKey;
}

interface JwkRecord {
  kty?: unknown;
  alg?: unknown;
  crv?: unknown;
  kid?: unknown;
  x?: unknown;
  y?: unknown;
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

const ES256_ALG = { name: "ECDSA", hash: "SHA-256" } as const;

/**
 * buildJwtKeys — разбор JWKS и импорт публичных ключей ES256 (EC P-256).
 * Ключи других типов/алгоритмов пропускаются; если пригодных нет — ошибка
 * конфигурации среды (не запроса): ответ 500 INTERNAL, как и при отсутствующем env.
 */
export async function buildJwtKeys(rawJwks: string): Promise<JwtVerifyKey[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJwks);
  } catch {
    throw new ConfigError("SUPABASE_JWKS", "SUPABASE_JWKS не является корректным JSON");
  }
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) {
    throw new ConfigError("SUPABASE_JWKS", "В SUPABASE_JWKS нет массива keys");
  }
  const imported: JwtVerifyKey[] = [];
  for (const entry of keys) {
    const jwk = entry as JwkRecord;
    if (jwk.kty !== "EC" || jwk.alg !== "ES256" || jwk.crv !== "P-256") continue;
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    imported.push({ kid: typeof jwk.kid === "string" && jwk.kid !== "" ? jwk.kid : null, key });
  }
  if (imported.length === 0) {
    throw new ConfigError("SUPABASE_JWKS", "В SUPABASE_JWKS нет ключей ES256 (EC P-256)");
  }
  return imported;
}

/**
 * verifyJwt — проверка подписи ES256 и срока; возвращает проверенные claims.
 * Подпись проверяется только ключом, чей kid совпадает с kid заголовка
 * (защита от подмены алгоритма); токен без kid допустим лишь при одном
 * ключе в наборе.
 */
export async function verifyJwt(
  token: string,
  keys: readonly JwtVerifyKey[],
  now: Date = new Date(),
): Promise<JwtClaims> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new ApiError("UNAUTHENTICATED", "Некорректный формат токена");
  }
  const header = decodeJsonPart(headerPart);
  if (header.alg !== "ES256") {
    throw new ApiError("UNAUTHENTICATED", "Неподдерживаемый алгоритм токена");
  }
  const kid = typeof header.kid === "string" && header.kid !== "" ? header.kid : null;
  const candidates = kid === null
    ? keys
    : keys.filter((candidate) => candidate.kid === kid);
  if (candidates.length === 0) {
    throw new ApiError("UNAUTHENTICATED", "Ключ подписи токена не найден в JWKS");
  }
  if (kid === null && candidates.length > 1) {
    throw new ApiError("UNAUTHENTICATED", "Токен без kid при нескольких ключах набора");
  }

  const data = encoder.encode(`${headerPart}.${payloadPart}`);
  let signatureOk = false;
  for (const candidate of candidates) {
    if (await crypto.subtle.verify(ES256_ALG, candidate.key, base64UrlToBytes(signaturePart), data)) {
      signatureOk = true;
      break;
    }
  }
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
