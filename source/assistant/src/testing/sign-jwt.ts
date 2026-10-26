// Тестовые утилиты (не для продакшена): ключ ES256 для тестов гейта.
// Копия core/src/testing/sign-jwt.ts с приведениями под @cloudflare/workers-types
// (в типах Workers generateKey возвращает объединение без сужения по алгоритму).

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Тестовый ключ подписи JWT: приватный для подписи, публичный — как JWKS. */
export interface TestJwtKeyPair {
  readonly kid: string;
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
  jwksJson(): string;
}

/** Создаёт пару EC P-256 для тестов. */
export async function createTestJwtKeyPair(kid = "test-es256-key"): Promise<TestJwtKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
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
