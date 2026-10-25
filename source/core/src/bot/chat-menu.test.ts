import { describe, expect, it, vi } from "vitest";
import {
  type BotCommandItem,
  RESIDENT_MENU_REGISTERED,
  RESIDENT_MENU_UNREGISTERED,
  syncResidentChatMenu,
} from "./chat-menu.ts";

const COMMAND_RE = /^[a-z0-9_]+$/;

function expectValid(items: BotCommandItem[]) {
  for (const item of items) {
    expect(item.command).toMatch(COMMAND_RE);
    expect(item.command.length).toBeLessThanOrEqual(32);
    expect(item.description.length).toBeGreaterThan(0);
    expect(item.description.length).toBeLessThanOrEqual(256);
  }
}

describe("меню команд бота жителей", () => {
  it("команды валидны и одинаковы по порядку в ru и kk", () => {
    for (const menu of [RESIDENT_MENU_UNREGISTERED, RESIDENT_MENU_REGISTERED]) {
      expectValid(menu.ru);
      expectValid(menu.kk);
      expect(menu.ru.map((item) => item.command)).toEqual(
        menu.kk.map((item) => item.command),
      );
    }
  });

  it("полное меню — 14 пунктов в порядке скриншота (25.10.2026)", () => {
    expect(RESIDENT_MENU_UNREGISTERED.ru.map((item) => item.command)).toEqual([
      "start",
      "register",
      "requests",
      "newrequest",
      "objects",
      "add",
      "invite",
      "bind",
      "accesses",
      "status",
      "fix",
      "delete",
      "notifications",
      "help",
    ]);
  });

  it("меню зарегистрированного — то же без /register (REG-01/02)", () => {
    expect(RESIDENT_MENU_REGISTERED.ru.map((item) => item.command)).toEqual(
      RESIDENT_MENU_UNREGISTERED.ru
        .map((item) => item.command)
        .filter((command) => command !== "register"),
    );
    expect(RESIDENT_MENU_REGISTERED.ru).toHaveLength(13);
    expect(
      RESIDENT_MENU_REGISTERED.ru.some((item) => item.command === "register"),
    ).toBe(false);
  });
});

describe("syncResidentChatMenu", () => {
  type Call = { sql: string; params: readonly unknown[] };

  function fakeExec(row: Record<string, unknown> | undefined) {
    const calls: Call[] = [];
    return {
      calls,
      exec: {
        query: async <T = Record<string, unknown>>(
          sql: string,
          params: readonly unknown[] = [],
        ): Promise<T[]> => {
          calls.push({ sql, params });
          if (sql.includes("menu_registered")) {
            return (row ? [row] : []) as T[];
          }
          return [] as T[];
        },
      },
    };
  }

  it("флаг не выставлен — применяет меню незарегистрированного и сохраняет флаг", async () => {
    const { exec, calls } = fakeExec({
      menu_registered: null,
      registered: false,
    });
    const apply = vi.fn(() => Promise.resolve());
    await syncResidentChatMenu(exec, "123", apply);
    expect(apply).toHaveBeenCalledWith("123", false);
    const upsert = calls.find((call) =>
      call.sql.startsWith("insert into bot_dialog_channel")
    );
    expect(upsert?.params).toEqual(["123", false]);
  });

  it("появился действующий профиль — применяет меню без «Регистрации»", async () => {
    const { exec, calls } = fakeExec({
      menu_registered: false,
      registered: true,
    });
    const apply = vi.fn(() => Promise.resolve());
    await syncResidentChatMenu(exec, "123", apply);
    expect(apply).toHaveBeenCalledWith("123", true);
    const upsert = calls.find((call) =>
      call.sql.startsWith("insert into bot_dialog_channel")
    );
    expect(upsert?.params).toEqual(["123", true]);
  });

  it("флаг совпадает с состоянием — apply не вызывается", async () => {
    for (const registered of [false, true]) {
      const { exec, calls } = fakeExec({
        menu_registered: registered,
        registered,
      });
      const apply = vi.fn(() => Promise.resolve());
      await syncResidentChatMenu(exec, "123", apply);
      expect(apply).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
    }
  });

  it("без строки диалога — состояние регистрации берётся из профиля", async () => {
    const { exec, calls } = fakeExec(undefined);
    const apply = vi.fn(() => Promise.resolve());
    await syncResidentChatMenu(exec, "123", apply);
    expect(apply).toHaveBeenCalledWith("123", false);
    expect(
      calls.some((call) =>
        call.sql.startsWith("insert into bot_dialog_channel")
      ),
    ).toBe(true);
  });

  it("зарегистрирован, но диалога ещё не было — применяет меню без «Регистрации»", async () => {
    const { exec, calls } = fakeExec({
      menu_registered: null,
      registered: true,
    });
    const apply = vi.fn(() => Promise.resolve());
    await syncResidentChatMenu(exec, "123", apply);
    expect(apply).toHaveBeenCalledWith("123", true);
    expect(
      calls.some((call) =>
        call.sql.startsWith("insert into bot_dialog_channel")
      ),
    ).toBe(true);
  });

  it("сбой apply — upsert флага не выполняется, синк повторится при следующей доставке", async () => {
    const { exec, calls } = fakeExec({
      menu_registered: null,
      registered: true,
    });
    await expect(
      syncResidentChatMenu(
        exec,
        "123",
        () => Promise.reject(new Error("TELEGRAM_500")),
      ),
    ).rejects.toThrow("TELEGRAM_500");
    expect(
      calls.some((call) =>
        call.sql.startsWith("insert into bot_dialog_channel")
      ),
    ).toBe(false);
  });
});
