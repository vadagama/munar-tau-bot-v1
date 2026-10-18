import { expect, it, vi } from "vitest";
import { sendNotifications } from "../domains/notifications/delivery.ts";
import type { DbClient } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
vi.mock("../domains/notifications/service.ts", async () => {
  const { makeTestActor } = await import("../testing/actors.ts");
  const actor = makeTestActor("administrator", []);
  actor.person.isTest = false;
  return {
    recipientActor: async () => actor,
    noticeAllowed: async () => true,
    preference: async () => "immediate",
  };
});
it("фактическая доставка сохраняет шаблон и дату сводки; старая очередь без даты совместима", async () => {
  let queued = 0, loads = 0;
  const item = {
    id: "i",
    text: "Новость &amp; отчёт",
    building_ids: [],
    event_type: "publication",
    is_test: false,
  };
  const db: DbClient = {
    close: async () => {},
    transaction: (fn) => fn(db),
    query: async <T>(sql: string) => {
      let rows: unknown[] = [];
      if (sql.includes("from message_template t")) {
        loads++;
        rows = [{
          key: "messages.notices.digest_dated",
          text_ru: "<b>События {date}</b>\n{items}",
          text_kk: "{items}",
          use_default: false,
        }, {
          key: "messages.notices.digest",
          text_ru: "Сводка\n{items}",
          text_kk: "{items}",
          use_default: false,
        }];
      } else if (sql.startsWith("select * from notification") && queued < 2) {
        rows = [{
          id: String(queued),
          recipient_person_id: "p",
          event_type: "digest",
          event_ref: {
            items: [item],
            ...(queued === 0 ? { day: "2026-10-18" } : {}),
          },
          channel: "telegram",
          is_test: false,
          attempts: 0,
          text: "Старый текст",
        }];
        queued++;
      } else if (sql.startsWith("select telegram_user_id")) {
        rows = [{
          telegram_user_id: "123",
        }];
      }
      return rows as T[];
    },
  };
  const send = vi.fn(async () => {});
  expect(await sendNotifications({ db } as RegistryDeps, send)).toBe(2);
  expect(send.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
    "<b>События 18.10.2026</b>\n• Новость &amp; отчёт",
    "Сводка\n• Новость &amp; отчёт",
  ]);
  expect(loads).toBe(1);
});
