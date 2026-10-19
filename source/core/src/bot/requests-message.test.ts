import { describe, expect, it } from "vitest";
import { requestCardText, requestListText } from "./request-text.ts";
import { requestStep } from "./requests.ts";
import { replyText } from "./keyboard.ts";
import { MemoryAuditRepo } from "../testing/memory.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { Actor } from "../pdp/types.ts";
import { message, messageButton, messagePreview } from "../templates/message.ts";
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
const targetPreview = () =>
  messagePreview(undefined, getTemplate("message.requests.target")!);
const commonPreview = () =>
  messagePreview(undefined, getTemplate("message.requests.common")!);

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
  const buildings = [
    { id: "house", code: "1", name: "Дом 1" },
    { id: "house2", code: "2", name: "Дом 2" },
  ];
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
    // Адресное обращение (REG-01): действующий профиль автора без связей.
    if (sql.startsWith("select 1 from profile pr join person")) return [{}] as T[];
    if (sql.startsWith("select p.number,p.kind,b.name,b.code from premises")) {
      return [{ number: "4", kind: "apartment", name: "Дом 1", code: "1" }] as T[];
    }
    if (sql.startsWith("select name,code from building where id=$1")) {
      return [{ name: "Дом 1", code: "1" }] as T[];
    }
    if (sql.startsWith("select id,name,code from building order by code")) {
      return buildings as T[];
    }
    if (sql.startsWith("select id,name,code from building where id::text")) {
      return [{ id: "house", code: "1", name: "Дом 1" }] as T[];
    }
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
] as const)("шаг вида: «%s» сохраняет вид %s и открывает выбор адресата", async (
  input,
  kind,
) => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", input, actor);
  expect(state.kind).toBe(kind);
  expect(state.step).toBe("target");
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

it.each(["ru", "kk"] as const)(
  "шаг адресата: предпросмотр совпадает с полным ответом на %s",
  async (lang) => {
    const state: Row = {};
    const d = deps({ count: 1, state });
    await requestStep(d, "1", "/newrequest", lang === "kk" ? kkActor : actor);
    const target = await requestStep(
      d,
      "1",
      "1",
      lang === "kk" ? kkActor : actor,
    );
    const preview = targetPreview()[lang];
    expect(replyText(target)).toBe(preview.text);
    expect(
      typeof target === "object" &&
        target.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(preview.buttons);
  },
);

it.each([
  ["1", "my_places"],
  ["2", "common"],
  ["мои помещения", "my_places"],
  ["помещения", "my_places"],
  ["общее имущество", "common"],
  ["имущество", "common"],
  ["ортақ мүлік", "common"],
] as const)("шаг адресата: «%s» → %s", async (input, target) => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor);
  await requestStep(d, "1", input, actor);
  expect(state.kind).toBe("request");
  if (target === "my_places") {
    expect(state.step).toBe("place");
  } else {
    expect(state.step).toBe("common");
  }
});

it("шаг адресата: недопустимый ввод повторяет вопрос", async () => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor);
  const again = await requestStep(d, "1", "не знаю", actor);
  expect(replyText(again)).toBe(targetPreview().ru.text);
});

it.each([[2, "default"], [1, "one"]] as const)(
  "мои помещения: предпросмотр совпадает с полным ответом для %s помещений",
  async (count, example) => {
    const state: Row = {};
    const d = deps({ count, state });
    await requestStep(d, "1", "/newrequest", actor);
    await requestStep(d, "1", "1", actor);
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

it.each([[2, "default"], [1, "one"]] as const)(
  "мои помещения: казахский предпросмотр совпадает для %s помещений",
  async (count, example) => {
    const state: Row = {};
    const d = deps({ count, state });
    await requestStep(d, "1", "/newrequest", kkActor);
    await requestStep(d, "1", "1", kkActor);
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

it.each(["ru", "kk"] as const)(
  "общее имущество: предпросмотр подменю и списка домов на %s",
  async (lang) => {
    const state: Row = {};
    const d = deps({ count: 1, state });
    const L = lang === "kk" ? kkActor : actor;
    await requestStep(d, "1", "/newrequest", L);
    await requestStep(d, "1", "1", L);
    const common = await requestStep(d, "1", "2", L);
    const commonExpected = commonPreview()[lang];
    expect(replyText(common)).toBe(commonExpected.text);
    expect(
      typeof common === "object" &&
        common.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual(commonExpected.buttons);
    const buildings = await requestStep(d, "1", "1", L);
    expect(replyText(buildings)).toBe(
      message(undefined, lang, "message.requests.building", {
        buildings: "1. Дом 1\n2. Дом 2",
      }),
    );
    expect(
      typeof buildings === "object" &&
        buildings.buttons?.map((row) => row.map((button) => button.text)),
    ).toEqual([["Дом 1"], ["Дом 2"]]);
  },
);

it("общее имущество: недопустимый ввод повторяет подменю", async () => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor);
  await requestStep(d, "1", "2", actor);
  const again = await requestStep(d, "1", "не знаю", actor);
  expect(replyText(again)).toBe(commonPreview().ru.text);
});

it("в доме: выбор дома кнопкой → текст места → черновик с видом и местом", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "3", actor); // жалоба
  await requestStep(d, "1", "2", actor); // общее имущество
  await requestStep(d, "1", "1", actor); // в доме → список
  const prompt = await requestStep(d, "1", "2", actor); // дом 2
  expect(replyText(prompt)).toBe(
    message(undefined, "ru", "message.requests.common_place", { name: "Дом 2" }),
  );
  await requestStep(d, "1", "подъезд 2", actor);
  await requestStep(d, "1", "Не работает освещение", actor);
  // После описания — файловый диалог; проверка после него (REQ-03).
  expect(state.step).toBe("attachments");
  const verify = await requestStep(d, "1", "нет", actor);
  expect(replyText(verify)).toBe(
    message(undefined, "ru", "message.requests.verify", {
      kind: "Жалоба",
      place: "Дом 2, подъезд 2",
      description: "Не работает освещение",
    }),
  );
  // insert into request(id, author, created_by, description, kind, …)
  const insert = captured.find((c) => c.sql.startsWith("insert into request("));
  expect(insert?.params[4]).toBe("complaint");
  expect(insert?.params[7]).toBe(null); // premises_id
  expect(insert?.params[8]).toBe("house2"); // building_id
  expect(insert?.params[9]).toBe("подъезд 2"); // location_text
});

it("в доме: выбор дома кодом текстом — альтернатива кнопкам", async () => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor);
  await requestStep(d, "1", "2", actor);
  await requestStep(d, "1", "1", actor);
  await requestStep(d, "1", "107/2", actor); // код дома текстом
  expect(state.building_id).toBe("house");
  expect(state.step).toBe("common_place");
});

it("на территории: текст места → черновик без дома и помещения", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor); // заявка на работу
  await requestStep(d, "1", "2", actor); // общее имущество
  const prompt = await requestStep(d, "1", "2", actor); // на территории
  expect(replyText(prompt)).toBe(
    templateText(undefined, "ru", "message.requests.common_territory"),
  );
  await requestStep(d, "1", "детская площадка у дома 1", actor);
  await requestStep(d, "1", "Не работает освещение", actor);
  const insert = captured.find((c) => c.sql.startsWith("insert into request("));
  expect(insert?.params[4]).toBe("request");
  expect(insert?.params[7]).toBe(null); // premises_id
  expect(insert?.params[8]).toBe(null); // building_id
  expect(insert?.params[9]).toBe("детская площадка у дома 1"); // location_text
  expect(state.place_label).toBe("детская площадка у дома 1");
});

it("мои помещения: старый синтаксис «дом КОД место» продолжает работать", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor); // вид: заявка на работу
  await requestStep(d, "1", "1", actor); // адресат: мои помещения
  await requestStep(d, "1", "дом 1 подъезд 3", actor);
  expect(state.step).toBe("description");
  await requestStep(d, "1", "Не работает освещение", actor);
  const insert = captured.find((c) => c.sql.startsWith("insert into request("));
  expect(insert?.params[7]).toBe(null); // premises_id
  expect(insert?.params[8]).toBe("house"); // building_id
  expect(insert?.params[9]).toBe("подъезд 3"); // location_text
  expect(state.place_label).toBe("Дом 1, подъезд 3");
});

it("без привязанных помещений: адрес одной строкой вместо шага адресата", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 0, state, captured });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "3", actor); // вид: жалоба
  // Шаг «Мои помещения / Общее имущество» пропущен — сразу адрес.
  expect(state.step).toBe("address");
  const afterEmpty = await requestStep(d, "1", "   ", actor);
  // Пустой ввод повторяет приглашение адреса.
  expect(state.step).toBe("address");
  expect(replyText(afterEmpty)).toBe(
    templateText(undefined, "ru", "message.requests.address"),
  );
  await requestStep(d, "1", "Дом 107/2, кв 40", actor);
  expect(state.location_text).toBe("Дом 107/2, кв 40");
  expect(state.premises_id).toBe(null);
  expect(state.building_id).toBe(null);
  expect(state.place_label).toBe("Дом 107/2, кв 40");
  expect(state.step).toBe("description");
  await requestStep(d, "1", "Не работает лифт", actor);
  expect(state.step).toBe("attachments");
  const card = await requestStep(d, "1", "нет", actor);
  expect(replyText(card)).toBe(
    message(undefined, "ru", "message.requests.verify", {
      kind: "Жалоба",
      place: "Дом 107/2, кв 40",
      description: "Не работает лифт",
    }),
  );
  const insert = captured.find((c) => c.sql.startsWith("insert into request("));
  expect(insert?.params[4]).toBe("complaint");
  expect(insert?.params[7]).toBe(null); // premises_id
  expect(insert?.params[8]).toBe(null); // building_id
  expect(insert?.params[9]).toBe("Дом 107/2, кв 40"); // location_text
});

it("без привязанных помещений: приглашение адреса на казахском", async () => {
  const state: Row = {};
  const d = deps({ count: 0, state });
  await requestStep(d, "1", "/newrequest", kkActor);
  const prompt = await requestStep(d, "1", "2", kkActor); // вид: вопрос
  expect(state.step).toBe("address");
  expect(replyText(prompt)).toBe(
    templateText(undefined, "kk", "message.requests.address"),
  );
});

it("мои помещения: «территория» без описания ведёт к приглашению места", async () => {
  const state: Row = {};
  const d = deps({ count: 1, state });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "1", actor); // вид: заявка на работу
  await requestStep(d, "1", "1", actor); // адресат: мои помещения
  await requestStep(d, "1", "территория", actor);
  expect(state.step).toBe("common_place");
  const prompt = await requestStep(d, "1", "детская площадка", actor);
  expect(state.location_text).toBe("детская площадка");
  expect(state.building_id).toBe(null);
  // следующий шаг — приглашение описания
  expect(replyText(prompt)).toBe(
    templateText(
      undefined,
      "ru",
      "requests.opishite_problemu_svoimi_slovami_kategoriya_ne_nuzhna",
    ),
  );
});

it("вид → место → описание: выбранный вид сохраняется в черновике", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured });
  await requestStep(d, "1", "/newrequest", actor);
  await requestStep(d, "1", "2", actor);
  await requestStep(d, "1", "1", actor);
  await requestStep(d, "1", "1", actor);
  const verify = await requestStep(d, "1", "Не работает освещение", actor);
  // После описания — файловый диалог, проверка позже (REQ-03).
  expect(replyText(verify)).toBe(
    templateText(undefined, "ru", "message.requests.attachments_prompt"),
  );
  expect(state.step).toBe("attachments");
  const card = await requestStep(d, "1", "нет", actor);
  expect(replyText(card)).toBe(
    message(undefined, "ru", "message.requests.verify", {
      kind: "Вопрос",
      place: "Дом 1, Квартира 4",
      description: "Не работает освещение",
    }),
  );
  const insert = captured.find((c) => c.sql.startsWith("insert into request("));
  expect(insert?.params[4]).toBe("question");
  expect(state.kind).toBe("question");
  expect(state.draft_id).toBe("r1");
});

it("/editrequest: черновик — сначала вид, затем текст; вид и место сохраняются", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const state: Row = {};
  const d = deps({ count: 1, state, captured, draft: DRAFT });
  const kind = await requestStep(d, "1", "/editrequest", actor);
  expect(replyText(kind)).toBe(kindPreview().ru.text);
  const prompt = await requestStep(d, "1", "3", actor);
  expect(replyText(prompt)).toBe(
    templateText(undefined, "ru", "requests.vvedite_novyy_tekst_chernovika"),
  );
  await requestStep(d, "1", "Не работает освещение", actor);
  expect(state.step).toBe("attachments");
  const card = await requestStep(d, "1", "нет", actor);
  expect(replyText(card)).toBe(
    message(undefined, "ru", "message.requests.verify", {
      kind: "Жалоба",
      place: "Дом 1, Квартира 4",
      description: "Не работает освещение",
    }),
  );
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
  await requestStep(d, "1", "1", actor);
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

describe("файловый диалог (REQ-03, R2.4)", () => {
  it("цикл «да → ожидание → ещё? → нет → проверка» проходим", async () => {
    const state: Row = {};
    const d = deps({ count: 1, state });
    await requestStep(d, "1", "/newrequest", actor);
    await requestStep(d, "1", "2", actor);
    await requestStep(d, "1", "1", actor);
    await requestStep(d, "1", "1", actor);
    await requestStep(d, "1", "Не работает освещение", actor);
    expect(state.step).toBe("attachments");
    // Недопустимый ввод повторяет вопрос.
    const again = await requestStep(d, "1", "не знаю", actor);
    expect(state.step).toBe("attachments");
    expect(replyText(again)).toBe(
      templateText(undefined, "ru", "message.requests.attachments_prompt"),
    );
    // «да» — ожидание медиа.
    const wait = await requestStep(d, "1", "да", actor);
    expect(state.step).toBe("attachments_wait");
    expect(replyText(wait)).toBe(
      templateText(undefined, "ru", "message.requests.attachments_wait"),
    );
    // Текст вместо медиа — повтор приглашения.
    const still = await requestStep(d, "1", "я передумал", actor);
    expect(state.step).toBe("attachments_wait");
    expect(replyText(still)).toBe(
      templateText(undefined, "ru", "message.requests.attachments_wait"),
    );
    // «нет» без файлов — карточка проверки с [Отправить].
    const card = await requestStep(d, "1", "нет", actor);
    expect(state.step).toBe("verify");
    expect(replyText(card)).toBe(
      message(undefined, "ru", "message.requests.verify", {
        kind: "Вопрос",
        place: "Дом 1, Квартира 4",
        description: "Не работает освещение",
      }),
    );
    expect(
      typeof card === "object" &&
        card.buttons?.[0]?.[0]?.data === "/sendrequest",
    ).toBe(true);
  });

  it("«ещё? → да» возвращается к ожиданию медиа, «ещё? → нет» — на проверку", async () => {
    const state: Row = { step: "attachments_more" };
    const d = deps({ count: 1, state });
    const wait = await requestStep(d, "1", "да", actor);
    expect(state.step).toBe("attachments_wait");
    expect(replyText(wait)).toBe(
      templateText(undefined, "ru", "message.requests.attachments_wait"),
    );
    await requestStep(d, "1", "нет", actor); // из ожидания — на проверку
    expect(state.step).toBe("verify");
    const more: Row = { step: "attachments_more", kind: "complaint" };
    const d2 = deps({ count: 1, state: more });
    const card = await requestStep(d2, "1", "нет", actor);
    expect(more.step).toBe("verify");
    expect(replyText(card)).toBe(
      message(undefined, "ru", "message.requests.verify", {
        kind: "Жалоба",
        place: templateText(undefined, "ru", "requests.net"),
        description: "",
      }),
    );
  });

  it("кнопки да/нет резолвятся из каталога на обоих языках", () => {
    for (const key of [
      "message.requests.attachments_prompt",
      "message.requests.attachments_wait",
      "message.requests.attachments_more",
    ]) {
      const def = getTemplate(key)!;
      expect(def.buttons?.map((b) => b.id)).toEqual(["yes", "no"]);
      for (const lang of ["ru", "kk"] as const) {
        expect(messageButton(undefined, lang, key, "yes")).toBeTruthy();
        expect(messageButton(undefined, lang, key, "no")).toBeTruthy();
      }
    }
  });
});
