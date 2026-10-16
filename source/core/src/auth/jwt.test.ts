// Тесты проверки JWT (HS256, WebCrypto) — AUTH-01, ADR-001.

import { describe, expect, it } from "vitest";

import { ApiError } from "../errors/api.ts";
import { signTestJwt } from "../testing/sign-jwt.ts";
import { verifyJwt } from "./jwt.ts";

const SECRET = "test-jwt-secret-обязательно-длинный";
const NOW = new Date("2026-10-16T10:00:00Z");

describe("verifyJwt", () => {
  it("корректный токен — claims извлечены", async () => {
    const token = await signTestJwt(
      { sub: "11111111-1111-1111-1111-111111111111", session_id: "s-1", exp: 10_000_000_000, role: "authenticated" },
      SECRET,
    );
    const claims = await verifyJwt(token, SECRET, NOW);
    expect(claims.sub).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims.sessionId).toBe("s-1");
    expect(claims.exp).toBe(10_000_000_000);
  });

  it("токен без session_id — sessionId null (не все провайдеры кладут claim)", async () => {
    const token = await signTestJwt({ sub: "u-1", exp: 10_000_000_000 }, SECRET);
    const claims = await verifyJwt(token, SECRET, NOW);
    expect(claims.sessionId).toBeNull();
  });

  it("неверная подпись (другой секрет) отклоняется", async () => {
    const token = await signTestJwt({ sub: "u-1", exp: 10_000_000_000 }, "другой-секрет");
    await expect(verifyJwt(token, SECRET, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("подделанная полезная нагрузка отклоняется", async () => {
    const token = await signTestJwt({ sub: "u-1", exp: 10_000_000_000 }, SECRET);
    const [head, , sig] = token.split(".");
    const forgedBody = btoa(JSON.stringify({ sub: "admin-u-1", exp: 10_000_000_000 }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    await expect(verifyJwt(`${head}.${forgedBody}.${sig}`, SECRET, NOW))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("истёкший токен отклоняется", async () => {
    const token = await signTestJwt({ sub: "u-1", exp: 1000 }, SECRET);
    await expect(verifyJwt(token, SECRET, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("токен без sub отклоняется", async () => {
    const token = await signTestJwt({ exp: 10_000_000_000 }, SECRET);
    await expect(verifyJwt(token, SECRET, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("алгоритм, отличный от HS256, отклоняется (защита от none/RS256)", async () => {
    const token = await signTestJwt({ sub: "u-1", exp: 10_000_000_000 }, SECRET, { alg: "none" });
    await expect(verifyJwt(token, SECRET, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("мусор вместо токена отклоняется как UNAUTHENTICATED (не 500)", async () => {
    await expect(verifyJwt("не-токен", SECRET, NOW)).rejects.toBeInstanceOf(ApiError);
    await expect(verifyJwt("a.b", SECRET, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
