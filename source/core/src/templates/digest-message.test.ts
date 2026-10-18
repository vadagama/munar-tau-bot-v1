import { expect, it, vi } from "vitest";
import { digestText } from "../domains/notifications/digest.ts";
import { makeTestActor } from "../testing/actors.ts";
import type { DbExecutor } from "../db/client.ts";
vi.mock(
  "../domains/notifications/service.ts",
  () => ({
    preference: async () => "digest",
    noticeAllowed: async () => true,
    recipientActor: async () => null,
  }),
);
it("шаблон сводки управляет датой, заголовком и расположением уведомлений", async () => {
  const store = new Map([["messages.notices.digest_dated", {
    ru: "<b>События {date}</b>\n{items}\nВсего хорошего",
    kk: "{items}",
  }]]);
  const actor = makeTestActor("administrator", []);
  const items = [{
    id: "one",
    text: "Вода &amp; свет",
    building_ids: [],
    event_type: "publication" as const,
    is_test: true,
  }];
  expect(await digestText({} as DbExecutor, actor, items, "2026-10-18", store))
    .toBe("<b>События 18.10.2026</b>\n• Вода &amp; свет\nВсего хорошего");
});
