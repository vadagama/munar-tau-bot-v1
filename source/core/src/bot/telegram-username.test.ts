/**
 * Модульные тесты синхронизации имени в Telegram: валидация username по
 * правилам Telegram и SQL обновления профиля/снимка анкеты (best-effort
 * захват в processInbound — см. inbound.test.ts).
 */
import { describe, expect, it, vi } from "vitest";

import {
  normalizeTelegramUsername,
  syncTelegramUsername,
} from "./telegram-username.ts";
import type { DbExecutor } from "../db/client.ts";

describe("normalizeTelegramUsername", () => {
  it("принимает корректный username", () => {
    expect(normalizeTelegramUsername("oleg_san_krasnov")).toBe("oleg_san_krasnov");
    expect(normalizeTelegramUsername("w84gr8")).toBe("w84gr8");
    expect(normalizeTelegramUsername("  User_Name1 ")).toBe("User_Name1");
  });

  it("отбрасывает отсутствующее, пустое и некорректное значение", () => {
    expect(normalizeTelegramUsername(undefined)).toBeNull();
    expect(normalizeTelegramUsername(null)).toBeNull();
    expect(normalizeTelegramUsername("")).toBeNull();
    expect(normalizeTelegramUsername("   ")).toBeNull();
    expect(normalizeTelegramUsername("abc")).toBeNull(); // короче 5 символов
    expect(normalizeTelegramUsername("с кириллицей")).toBeNull();
    expect(normalizeTelegramUsername("bad name!")).toBeNull();
    expect(normalizeTelegramUsername("a".repeat(33))).toBeNull();
  });
});

describe("syncTelegramUsername", () => {
  it("обновляет профиль и снимок активных анкет переданным именем", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const exec = { query } as unknown as DbExecutor;
    await syncTelegramUsername(exec, "100", "w84gr8");
    expect(query).toHaveBeenCalledTimes(2);
    const [profileSql, profileParams] = query.mock.calls[0]!;
    expect(String(profileSql).startsWith("update profile set telegram_username")).toBe(true);
    expect(profileParams).toEqual(["100", "w84gr8"]);
    const [registrationSql, registrationParams] = query.mock.calls[1]!;
    expect(String(registrationSql)).toContain("state in ('pending_review','need_clarification','disputed')");
    expect(registrationSql).toContain("superseded_by is null");
    expect(registrationParams).toEqual(["100", "w84gr8"]);
  });

  it("отсутствие username очищает значение (is distinct from null)", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const exec = { query } as unknown as DbExecutor;
    await syncTelegramUsername(exec, "100", undefined);
    expect(query.mock.calls[0]![1]).toEqual(["100", null]);
    expect(query.mock.calls[1]![1]).toEqual(["100", null]);
  });
});
