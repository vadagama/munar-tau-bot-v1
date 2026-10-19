import { expect, it } from "vitest";
import { requestCardText, requestListText } from "./request-text.ts";
import { requestStep } from "./requests.ts";
import { replyText } from "./keyboard.ts";
import { MemoryAuditRepo } from "../testing/memory.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { Actor } from "../pdp/types.ts";
import { message, messagePreview } from "../templates/message.ts";
import { getTemplate } from "../templates/catalog/index.ts";
import { t as templateText, type TemplateStore } from "../templates/store.ts";
import type { Row } from "../domains/registry/validation.ts";

const actor: Actor = {
  profile: { id: "profile", personId: "person", language: "ru", isTest: true },
  person: { id: "person", fullName: "Тест", status: "active", isTest: true },
  assignments: [],
  emulation: null,
};
const kkActor: Actor = {
  ...actor,
  profile: { ...actor.profile, language: "kk" },
};

const kindPreview = () =>
  messagePreview(undefined, getTemplate("message.requests.kind")!);

const DRAFT: Row = {
  id: "r1",
  author_person_id: "person",
  state: "draft",
  kind: "request",
  premises_id: "a",
  building_id: "house",
  location_text: null,
  description: "старый текст",
  version: 1,
  is_test: true,
  complaint_subject_person_id: null,
  confirmation_version: 1,
};

interface FakeOptions {
  count?: number;
  templates?: TemplateStore;
  state?: Row;
  draft?: Row | null;
  captured?: { sql: string; params: readonly unknown[] }[];
}

/** Фейк БД: общее состояние диалога между вызовами + захват SQL-параметров. */
function deps({
  count = 2,
  templates,
  state = {},
  draft = null,
  captured,
}: FakeOptions = {}) {
  const places = [{
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
  const query: DbExecutor["query"] = async <T>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> => {
    captured?.push({ sql, params: params ?? [] });
    if (sql.startsWith("select state from bot_dialog")) {
      return [{ state }] as T[];
    }
    if (sql.startsWith("select p.id")) return places as T[];
    if (sql.startsWith("select * from request where author_person_id")) {
      return (draft ? [draft] : []) as T[];
    }
    if (sql.startsWith("select id,version from request where author_person_id")) {
      return (draft ? [{ id: draft.id, version: draft.version }] : []) as T[];
    }
    if (sql.startsWith("select * from request where id=$1")) {
      return (draft ? [draft] : []) as T[];
    }
    if (sql.includes("as participant")) {
      return [{ participant: true, active_author: true }] as T[];
    }
    if (sql.startsWith("select building_id,is_test from premises")) {
      return [{ building_id: "house", is_test: true }] as T[];
    }
    if (sql.startsWith("select 1 from connection")) return [{}] as T[];
    if (sql.startsWith("select id from building where id=$1")) {
      return [{ id: "house" }] as T[];
    }
    if (sql.startsWith("insert into request(")) {
      return [{ id: "r1", version: 1, state: "draft" }] as T[];
    }
    if (sql.startsWith("update request set description")) {
      return [{ ...DRAFT, kind: params?.[5] ?? DRAFT.kind }] as T[];
    }
    return [];
  };
  const db: DbClient = {
    query,
    transaction: (fn) => fn({ query }),
    close: async () => {},
  };
  return { db, audit: new MemoryAuditRepo(), templates };
}

it.each(["ru", "kk"] as const)(
  "/newrequest: предпросмотр шага вида совпадает с полным ответом на %s",
  async (lang) => {
    const result = await requestStep(
      deps({ count: 1 }),
      "1",
      "/newrequest",
      lang === "kk" ? kkActor : actor,
    );
    const preview = kindPreview()[lang];
    expect(replyText(result)).toBe(preview.text);
    expect(
      typeof result === "object" &&
        result.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(preview.buttons);
  },
);

it.each([
  ["1", "request"],
  ["2", "question"],
  ["3", "complaint"],
  ["заявка", "request"],
  ["Заявка на работу", "request"],
  ["жұмысқа өтінім", "request"],
  ["вопрос", "question"],
  ["Сұрақ", "question"],
  ["жалоба", "complaint"],
  ["Шағым", "complaint"],
] as const)("шаг вида: «%s» сохраняет вид %s и открывает выбор места", async (
  input,
  kind,
) => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", input, actor);
  expect(state.kind).toBe(kind);
  expect(state.step).toBe("place");
});

it.each(["5", "не знаю", "дом 1"])(
  "шаг вида: недопустимый ввод «%s» повторяет вопрос",
  async (input) => {
    const state: Row = {};
    const d = deps({ count: 1, state });
    await requestStep(d, "1", "/newrequest", actor);
    const again = await requestStep(d, "1", input, actor);
    expect(replyText(again)).toBe(kindPreview().ru.text);
    expect(state.kind).toBeUndefined();
  },
);

it.each([[2, "default"], [1, "one"], [0, "empty"]] as const)(
  "вид → место: предпросмотр совпадает с полным ответом для %s помещений",
  async (count, example) => {
    const state: Row = {};
    const d = deps({ count, state });
    await requestStep(d, "1", "/newrequest", actor);
    const place = await requestStep(d, "1", "1", actor);
    const preview = messagePreview(
      undefined,
      getTemplate("message.requests.choose_place")!,
      example,
    ).ru;
    expect(replyText(place)).toBe(preview.text);
    expect(
      typeof place === "object" &&
        place.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(preview.buttons);
  },
);

it.each([[2, "default"], [1, "one"], [0, "empty"]] as const)(
  "вид → место: казахский предпросмотр совпадает для %s помещений",
  async (count, example) => {
    const state: Row = {};
    const d = deps({ count, state });
    await requestStep(d, "1", "/newrequest", kkActor);
    const place = await requestStep(d, "1", "1", kkActor);
    const preview = messagePreview(
      undefined,
      getTemplate("message.requests.choose_place")!,
      example,
    ).kk;
    expect(replyText(place)).toBe(preview.text);
    expect(
      typeof place === "object" &&
        place.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(preview.buttons);
  },
);

it("вид → место → описание: выбранный вид сохраняется в черновике", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "2", actor);
  await requestStep(d, "1", "1", actor);
  const verify = await requestStep(d, "1", "Не работает освещение", actor);
  const verifyPreview = messagePreview(
    undefined,
    getTemplate("message.requests.verify")!,
  ).ru;
  expect(replyText(verify)).toBe(verifyPreview.text);
  // insert into request(id, author, created_by, description, kind, …) — вид пятый параметр
  const insert = captured.find((c) =>
    c.sql.startsWith("insert into request(")
  );
  expect(insert?.params[4]).toBe("question");
  expect(state.kind).toBe("question");
  expect(state.draft_id).toBe("r1");
});

it("/editrequest: черновик — сначала вид, затем текст; вид меняется в черновике", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured, draft: DRAFT });
  const kind = await requestStep(d, "1", "/editrequest", actor);
  expect(replyText(kind)).toBe(kindPreview().ru.text);
  const prompt = await requestStep(d, "1", "3", actor);
  expect(replyText(prompt)).toBe(
    templateText(undefined, "ru", "requests.vvedite_novyy_tekst_chernovika"),
  );
  const verify = await requestStep(d, "1", "Не работает освещение", actor);
  const verifyPreview = messagePreview(
    undefined,
    getTemplate("message.requests.verify")!,
  ).ru;
  expect(replyText(verify)).toBe(verifyPreview.text);
  // update request set description=$2,premises_id=$3,building_id=$4,location_text=$5,kind=$6 …
  const update = captured.find((c) =>
    c.sql.startsWith("update request set description")
  );
  expect(update?.params[5]).toBe("complaint");
  expect(state.step).toBe("verify");
});

it("старый черновик открывается без ошибок: /newrequest показывает сохранённый черновик", async () => {
  const state: Row = {};
  const d = deps({ count: 1, state, draft: DRAFT });
  const reply = await requestStep(d, "1", "/newrequest", actor);
  expect(replyText(reply)).toBe(
    message(undefined, "ru", "message.requests.saved_draft", {
      description: "старый текст",
    }),
  );
  expect(state.step).toBe("verify");
});

it("/editrequest применяет цельный шаблон шага вида, сохраняя callback", async () => {
  const templates = new Map([["message.requests.kind", {
    ru: "Что оформляем?\n{kinds}",
    kk: "{kinds}",
    buttons: {
      ru: { request: "На работу", question: "Спросить", complaint: "Пожаловаться" },
      kk: { request: "Жұмыс", question: "Сұрақ", complaint: "Шағым" },
    },
  }]]);
  const result = await requestStep(
    deps({ count: 1, templates }),
    "1",
    "/newrequest",
    actor,
  );
  expect(replyText(result)).toBe(
    "Что оформляем?\n1. На работу\n2. Спросить\n3. Пожаловаться",
  );
  expect(typeof result === "object" && result.buttons?.[2]?.[0]).toEqual({
    text: "Пожаловаться",
    data: "3",
  });
});

it("выбор помещения применяет цельный шаблон и редактируемые подписи, сохраняя callback", async () => {
  const templates = new Map([["message.requests.choose_place", {
    ru: "Помещение:\n{premises}\nВыберите ниже",
    kk: "{premises}",
    buttons: {
      ru: { place: "{building} · №{number}" },
      kk: { place: "{number}" },
    },
  }]]);
  const state: Row = {};
  const d = deps({ count: 1, templates, state });
  await requestStep(d, "1", "/newrequest", actor);
  const result = await requestStep(d, "1", "1", actor);
  expect(replyText(result)).toBe(
    "Помещение:\n1. Дом 1, Квартира 4\nВыберите ниже",
  );
  expect(typeof result === "object" && result.buttons?.[0]?.[0]).toEqual({
    text: "Дом 1 · №4",
    data: "1",
  });
});

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
