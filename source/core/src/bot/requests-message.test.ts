import { expect, it } from "vitest";
import { requestCardText, requestListText } from "./request-text.ts";
import { requestStep } from "./requests.ts";
import { replyText } from "./keyboard.ts";
import { MemoryAuditRepo } from "../testing/memory.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { Actor } from "../pdp/types.ts";
import { messagePreview } from "../templates/message.ts";
import { getTemplate } from "../templates/catalog/index.ts";
import type { TemplateStore } from "../templates/store.ts";

const actor: Actor = {
  profile: { id: "profile", personId: "person", language: "ru", isTest: true },
  person: { id: "person", fullName: "Тест", status: "active", isTest: true },
  assignments: [],
  emulation: null,
};
function deps(count: number, templates?: TemplateStore) {
  const rows = [{
    id: "a",
    building_id: "house",
    name: "Дом 1",
    code: "1",
    kind: "apartment",
    number: "4",
  }, {
    id: "b",
    building_id: "house",
    name: "Дом 1",
    code: "1",
    kind: "parking_slot",
    number: "25",
  }].slice(0, count);
  const query: DbExecutor["query"] = async <T>(sql: string): Promise<T[]> => {
    if (sql.startsWith("select state from bot_dialog")) {
      return [{ state: {} }] as T[];
    }
    if (sql.startsWith("select p.id")) return rows as T[];
    return [];
  };
  const db: DbClient = {
    query,
    transaction: (fn) => fn({ query }),
    close: async () => {},
  };
  return { db, audit: new MemoryAuditRepo(), templates };
}
it.each([[2, "default"], [1, "one"], [0, "empty"]] as const)(
  "/newrequest: предпросмотр совпадает с полным ответом для %s помещений",
  async (count, example) => {
    const result = await requestStep(deps(count), "1", "/newrequest", actor);
    const preview = messagePreview(
      undefined,
      getTemplate("message.requests.choose_place")!,
      example,
    ).ru;
    expect(replyText(result)).toBe(preview.text);
    expect(
      typeof result === "object" &&
        result.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(preview.buttons);
  },
);
it("/newrequest применяет цельный шаблон и редактируемые подписи, сохраняя callback", async () => {
  const templates = new Map([["message.requests.choose_place", {
    ru: "Помещение:\n{premises}\nВыберите ниже",
    kk: "{premises}",
    buttons: {
      ru: { place: "{building} · №{number}" },
      kk: { place: "{number}" },
    },
  }]]);
  const result = await requestStep(
    deps(1, templates),
    "1",
    "/newrequest",
    actor,
  );
  expect(replyText(result)).toBe(
    "Помещение:\n1. Дом 1, Квартира 4\nВыберите ниже",
  );
  expect(typeof result === "object" && result.buttons?.[0]?.[0]).toEqual({
    text: "Дом 1 · №4",
    data: "1",
  });
});

it.each([[2, "default"], [1, "one"], [0, "empty"]] as const)(
  "/newrequest: казахский предпросмотр совпадает для %s помещений",
  async (count, example) => {
    const result = await requestStep(deps(count), "1", "/newrequest", {
      ...actor,
      profile: { ...actor.profile, language: "kk" },
    });
    const preview = messagePreview(
      undefined,
      getTemplate("message.requests.choose_place")!,
      example,
    ).kk;
    expect(replyText(result)).toBe(preview.text);
    expect(
      typeof result === "object" &&
        result.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(preview.buttons);
  },
);

it.each(["ru", "kk"] as const)(
  "предпросмотр списка и истории карточки совпадает с runtime на %s и безопасен для HTML",
  (lang) => {
    const row = {
      number: "З-26-00001",
      state: "in_work",
      author_person_id: "author",
      description: "Не работает <лампа> & свет",
      created_at: "2026-10-20T07:00:00Z",
      place_label: "Дом 1, Квартира 4",
      messages: [{
        channel: "resident",
        author_person_id: "staff",
        author_kind: "staff",
        text: "Передано <электрику> & мастеру",
        created_at: "2026-10-20T07:30:00Z",
      }],
    };
    const list = requestListText([row], "author", 1, lang);
    const listPreview =
      messagePreview(undefined, getTemplate("message.requests.list")!)[lang];
    expect(replyText(list)).toBe(listPreview.text);
    expect(
      typeof list === "object" &&
        list.buttons?.map((r) => r.map((b) => b.text)),
    ).toEqual(listPreview.buttons);
    const card = requestCardText(row, lang);
    const cardPreview = messagePreview(
      undefined,
      getTemplate("message.requests.card.active")!,
    )[lang];
    expect(replyText(card)).toBe(cardPreview.text);
    expect(replyText(card)).toContain("&lt;электрику&gt; &amp; мастеру");
    expect(replyText(card)).not.toContain("<электрику>");
  },
);
