// Тестовые утилиты (не для продакшена): ключ ES256 для тестов ядра и функций.
// Повторяет формат Supabase Auth: асимметричная подпись ES256 (EC P-256),
// kid в заголовке, публичная часть в форме JWKS (SUPABASE_JWKS).

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Тестовый ключ подписи JWT: приватный для подписи, публичный — как JWKS. */
export interface TestJwtKeyPair {
  /** Идентификатор ключа, проставляемый в заголовок токена и в JWKS. */
  readonly kid: string;
  /** Подписывает токен ES256 — как Supabase Auth. */
  sign(
    payload: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Promise<string>;
  /** Публичная часть ключа в форме JWKS — подставка для buildJwtKeys. */
  jwksJson(): string;
}

/** Создаёт пару EC P-256 для тестов. */
export async function createTestJwtKeyPair(kid = "test-es256-key"): Promise<TestJwtKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    kid,
    async sign(payload, header) {
      const head = bytesToBase64Url(encoder.encode(JSON.stringify(
        header ?? { alg: "ES256", typ: "JWT", kid },
      )));
      const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        encoder.encode(`${head}.${body}`),
      );
      return `${head}.${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
    },
    jwksJson() {
      return JSON.stringify({
        keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }],
      });
    },
  };
}
