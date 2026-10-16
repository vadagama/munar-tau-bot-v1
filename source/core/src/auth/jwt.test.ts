// Тесты проверки JWT (ES256 по JWKS, WebCrypto) — AUTH-01, ADR-001.
// Supabase Auth выпускает токены с асимметричной подписью; публичные ключи
// приходят в SUPABASE_JWKS (см. jwt.ts).

import { describe, expect, it } from "vitest";

import { ConfigError } from "../config/env.ts";
import { ApiError } from "../errors/api.ts";
import { createTestJwtKeyPair, type TestJwtKeyPair } from "../testing/sign-jwt.ts";
import { buildJwtKeys, verifyJwt } from "./jwt.ts";

const NOW = new Date("2026-10-16T10:00:00Z");

/** Объединяет JWKS нескольких пар (для сценариев ротации/неоднозначности). */
function combinedJwks(pairs: TestJwtKeyPair[]): string {
  const keys = pairs.flatMap((pair) => (JSON.parse(pair.jwksJson()) as { keys: unknown[] }).keys);
  return JSON.stringify({ keys });
}

describe("buildJwtKeys", () => {
  it("импортирует ES256-ключ из JWKS тестовой пары", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    expect(keys).toHaveLength(1);
    expect(keys[0]!.kid).toBe("test-es256-key");
  });

  it("некорректный JSON — ConfigError (ошибка среды, не запроса)", async () => {
    await expect(buildJwtKeys("не-json")).rejects.toBeInstanceOf(ConfigError);
  });

  it("нет массива keys — ConfigError", async () => {
    await expect(buildJwtKeys("{}")).rejects.toBeInstanceOf(ConfigError);
  });

  it("нет пригодных ES256-ключей — ConfigError", async () => {
    await expect(buildJwtKeys('{"keys":[{"kty":"oct","k":"x"}]}')).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("verifyJwt", () => {
  it("корректный токен — claims извлечены", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    const token = await pair.sign(
      { sub: "11111111-1111-1111-1111-111111111111", session_id: "s-1", exp: 10_000_000_000, role: "authenticated" },
    );
    const claims = await verifyJwt(token, keys, NOW);
    expect(claims.sub).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims.sessionId).toBe("s-1");
    expect(claims.exp).toBe(10_000_000_000);
  });

  it("токен без session_id — sessionId null (не все провайдеры кладут claim)", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    const claims = await verifyJwt(await pair.sign({ sub: "u-1", exp: 10_000_000_000 }), keys, NOW);
    expect(claims.sessionId).toBeNull();
  });

  it("подпись чужим ключом (не из JWKS) отклоняется", async () => {
    const pair = await createTestJwtKeyPair();
    const foreign = await createTestJwtKeyPair("foreign-key");
    const keys = await buildJwtKeys(pair.jwksJson());
    const token = await foreign.sign({ sub: "u-1", exp: 10_000_000_000 });
    await expect(verifyJwt(token, keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("kid, отсутствующий в JWKS, отклоняется", async () => {
    const pair = await createTestJwtKeyPair();
    const other = await createTestJwtKeyPair("other-key");
    const keys = await buildJwtKeys(pair.jwksJson());
    // Токен подписан валидным ключом, но kid подменён на чужой: подпись не
    // совпадёт с выбранным по kid ключом.
    const token = await pair.sign({ sub: "u-1", exp: 10_000_000_000 }, { alg: "ES256", typ: "JWT", kid: other.kid });
    await expect(verifyJwt(token, keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("токен без kid при нескольких ключах набора отклоняется (неоднозначность)", async () => {
    const first = await createTestJwtKeyPair("k1");
    const second = await createTestJwtKeyPair("k2");
    const keys = await buildJwtKeys(combinedJwks([first, second]));
    const token = await first.sign({ sub: "u-1", exp: 10_000_000_000 }, { alg: "ES256", typ: "JWT" });
    await expect(verifyJwt(token, keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("токен без kid при одном ключе набора проходит", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    const token = await pair.sign({ sub: "u-1", exp: 10_000_000_000 }, { alg: "ES256", typ: "JWT" });
    const claims = await verifyJwt(token, keys, NOW);
    expect(claims.sub).toBe("u-1");
  });

  it("подделанная полезная нагрузка отклоняется", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    const token = await pair.sign({ sub: "u-1", exp: 10_000_000_000 });
    const [head, , sig] = token.split(".");
    const forgedBody = btoa(JSON.stringify({ sub: "admin-u-1", exp: 10_000_000_000 }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    await expect(verifyJwt(`${head}.${forgedBody}.${sig}`, keys, NOW))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("истёкший токен отклоняется", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    const token = await pair.sign({ sub: "u-1", exp: 1000 });
    await expect(verifyJwt(token, keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("токен без sub отклоняется", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    const token = await pair.sign({ exp: 10_000_000_000 });
    await expect(verifyJwt(token, keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("алгоритм, отличный от ES256, отклоняется (защита от none/HS256/RS256)", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    for (const alg of ["none", "HS256", "RS256"]) {
      const token = await pair.sign({ sub: "u-1", exp: 10_000_000_000 }, { alg, typ: "JWT", kid: pair.kid });
      await expect(verifyJwt(token, keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });

  it("мусор вместо токена отклоняется как UNAUTHENTICATED (не 500)", async () => {
    const pair = await createTestJwtKeyPair();
    const keys = await buildJwtKeys(pair.jwksJson());
    await expect(verifyJwt("не-токен", keys, NOW)).rejects.toBeInstanceOf(ApiError);
    await expect(verifyJwt("a.b", keys, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
