/**
 * Модульные тесты входа бота (срез UX B): callback_query исполняется как
 * текстовый эквивалент команды, reply-меню прикрепляется к /start и /help,
 * повторная доставка того же update не отвечает второй раз (дедуп по
 * паре (bot, update_id)). SQL имитируется по префиксам запросов — как в
 * registration.test.ts.
 */
import { describe, expect, it } from "vitest";

import { processInbound } from "./inbound.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";

interface Capture {
  params?: unknown[];
  sql: string;
}

function harness() {
  const delivered = new Set<string>();
  const notifications: Capture[] = [];
  const dialogState: Row = {};
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.startsWith("insert into bot_inbound")) {
        const key = `${params![0]}:${params![1]}`;
        if (delivered.has(key)) return Promise.resolve([] as T[]);
        delivered.add(key);
        return Promise.resolve([{ update_id: params![1] }] as T[]);
      }
      if (sql.startsWith("select state from bot_dialog")) {
        return Promise.resolve([{ state: dialogState }] as T[]);
      }
      if (sql.startsWith("insert into notification")) {
        notifications.push({ sql, params });
        return Promise.resolve([] as T[]);
      }
      // actorForTelegram, bot_dialog, статус доставки, язык профиля и прочее — пусто.
      return Promise.resolve([] as T[]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  return {
    deps: { db, audit: {} } as unknown as RegistryDeps,
    notifications,
  };
}

const helpUpdate = (updateId: number): Row => ({
  update_id: updateId,
  message: {
    text: "/help",
    from: { id: 100 },
    chat: { id: 100, type: "private" },
  },
});

const helpCallback = (updateId: number): Row => ({
  update_id: updateId,
  callback_query: {
    id: `cb${updateId}`,
    data: "/help",
    from: { id: 100 },
    message: { chat: { id: 100, type: "private" } },
  },
});

describe("processInbound: callback_query (срез UX B)", () => {
  it("нажатие кнопки исполняется как её текстовая команда и получает reply-меню", async () => {
    const h = harness();
    const processed = await processInbound(h.deps, helpCallback(1), "resident");
    expect(processed).toBe(true);
    expect(h.notifications.length).toBe(1);
    const [, text, , bot, markup] = h.notifications[0]!.params as [
      unknown,
      string,
      unknown,
      string,
      string | null,
    ];
    // Справка бота жителей уходит тем же ботом.
    expect(text).toContain("ОСИ ЖК «Мунар Тау»");
    expect(bot).toBe("resident");
    // Меню главных действий прикрепляется к /help — как и для текста команды.
    const parsed = JSON.parse(markup!) as { keyboard: { text: string }[][] };
    expect(parsed.keyboard.flat().map((b) => b.text)).toContain("/newrequest");
  });

  it("кнопка сценария без профиля — дружелюбная ошибка вместо кода API", async () => {
    const h = harness();
    const update: Row = {
      update_id: 2,
      callback_query: {
        id: "cb2",
        data: "/requests",
        from: { id: 100 },
        message: { chat: { id: 100, type: "private" } },
      },
    };
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.notifications.length).toBe(1);
    expect(h.notifications[0]!.params![1]).toContain("Недостаточно прав");
    // Меню на команду /requests не прикрепляется — разметки нет.
    expect(h.notifications[0]!.params![4]).toBeNull();
  });

  it("обычное сообщение без команды-меню уходит без разметки", async () => {
    const h = harness();
    const update: Row = {
      update_id: 3,
      message: {
        text: "/status",
        from: { id: 100 },
        chat: { id: 100, type: "private" },
      },
    };
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.notifications.length).toBe(1);
    expect(h.notifications[0]!.params![1]).toContain("Анкет пока нет");
    expect(h.notifications[0]!.params![4]).toBeNull();
  });

  it("повторная доставка update не отвечает второй раз (дедуп по паре bot+update_id)", async () => {
    const h = harness();
    expect(await processInbound(h.deps, helpUpdate(4), "resident")).toBe(true);
    expect(await processInbound(h.deps, helpUpdate(4), "resident")).toBe(false);
    expect(h.notifications.length).toBe(1);
  });

  it("некорректный update_id отклоняется до записи в bot_inbound", async () => {
    const h = harness();
    await expect(
      processInbound(h.deps, { update_id: "мусор" }, "resident"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(h.notifications.length).toBe(0);
  });
});
