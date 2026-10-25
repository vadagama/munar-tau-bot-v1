// Проверки шифрования токена провайдера (ADR-021, S0.2): AES-256-GCM,
// формат v1:<iv_b64>:<ct_b64>, маска без раскрытия значения.

import { describe, expect, it } from "vitest";
import {
  decodeKeySecret,
  decryptApiKey,
  encryptApiKey,
  generateKeySecret,
  maskApiKey,
} from "./crypto.ts";

const KEY = decodeKeySecret(generateKeySecret());

describe("crypto домена assistant", () => {
  it("roundtrip: расшифровка возвращает исходный токен", async () => {
    const token = "sk-test-1234567890abcdef";
    const encrypted = await encryptApiKey(token, KEY);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(await decryptApiKey(encrypted, KEY)).toBe(token);
  });

  it("шифрование не содержит открытого токена", async () => {
    const token = "sk-open-secret-value";
    const encrypted = await encryptApiKey(token, KEY);
    expect(encrypted.includes(token)).toBe(false);
  });

  it("каждое шифрование даёт новый IV", async () => {
    const a = await encryptApiKey("same", KEY);
    const b = await encryptApiKey("same", KEY);
    expect(a).not.toBe(b);
  });

  it("чужой ключ не расшифровывает", async () => {
    const encrypted = await encryptApiKey("secret", KEY);
    await expect(decryptApiKey(encrypted, decodeKeySecret(generateKeySecret()))).rejects.toThrow();
  });

  it("неизвестный формат отклоняется", async () => {
    await expect(decryptApiKey("plain-text", KEY)).rejects.toThrow();
    await expect(decryptApiKey("v2:aaa:bbb", KEY)).rejects.toThrow();
  });

  it("decodeKeySecret требует ровно 32 байта base64", () => {
    expect(() => decodeKeySecret("too-short")).toThrow();
    expect(() => decodeKeySecret(btoa("0123456789abcdef"))).toThrow();
    expect(decodeKeySecret(generateKeySecret()).length).toBe(32);
  });

  it("маска показывает последние 4 символа", () => {
    expect(maskApiKey("sk-abcdef123456")).toBe("••••3456");
    expect(maskApiKey("abc")).toBe("••••");
    expect(maskApiKey("sk-abcdef123456")).not.toContain("sk-");
  });
});
