import { expect, it } from "vitest";
import { getTemplate, TEMPLATE_CATALOG } from "./catalog/index.ts";
import { effectiveText, legacyProjection, loadTemplateStore } from "./store.ts";
import {
  message,
  messageButton,
  messagePreview,
  safeBlock,
} from "./message.ts";
import { listTemplates, previewTemplate } from "./service.ts";
import { makeTestActor } from "../testing/actors.ts";
const key = "message.requests.choose_place",
  actor = makeTestActor("administrator", []);
it("каталог показывает сообщения со сценарием; внутренние слова скрыты", async () => {
  const items = await listTemplates({ query: async <T>() => [] as T[] }, actor);
  expect(items.length).toBeGreaterThan(100);
  expect(items.every((x) => !!x.scenario)).toBe(true);
  expect(items.some((x) => x.key === "requests.net")).toBe(false);
  expect(items.find((x) => x.key === key)?.default_ru).toContain("{premises}");
});
it("новое переопределение управляет всем сообщением и кнопкой; HTML данных экранируется", () => {
  const store = new Map([[key, {
    ru: "<b>Место</b>\n{premises}\nНазад /requestcancel",
    kk: "{premises}",
    buttons: {
      ru: { place: "{building} · {number}" },
      kk: { place: "{number}" },
    },
  }]]);
  expect(message(store, "ru", key, { premises: "<script>" })).toBe(
    "<b>Место</b>\n&lt;script&gt;\nНазад /requestcancel",
  );
  expect(
    messageButton(store, "ru", key, "place", { building: "Дом 1", number: 4 }),
  ).toBe("Дом 1 · 4");
  expect(
    message(store, "kk", key, {
      premises: safeBlock("<b>Безопасный блок</b>"),
    }),
  ).toBe("<b>Безопасный блок</b>");
});
it("однозначный старый текст сохраняется, новый reset возвращает именно новый дефолт", async () => {
  const old = "requests.vyberite_nomer_svoego_pomescheniya",
    def = getTemplate(key)!;
  const store = new Map([[old, {
    ru: "Выберите помещение ниже:",
    kk: "Таңдаңыз:",
  }]]);
  expect(effectiveText(store, def, "ru")).toContain("Выберите помещение ниже:");
  expect(legacyProjection(store, def, "ru").unresolved).toEqual([]);
  const reset = await loadTemplateStore({
    query: async <T>() =>
      [{ key: old, text_ru: "Старое", text_kk: "Ескі", use_default: false }, {
        key,
        use_default: true,
      }] as T[],
  });
  expect(effectiveText(reset, def, "ru")).toBe(def.ru);
});
it("неоднозначный перенос и подстроки слов требуют сверки", () => {
  const old = "requests.net",
    store = new Map([[old, { ru: "нет данных", kk: "жоқ" }]]);
  const def = {
    ...getTemplate(key)!,
    ru: "Интернет доступен",
    legacyKeys: [old],
  };
  expect(legacyProjection(store, def, "ru")).toEqual({
    text: def.ru,
    unresolved: [old],
  });
  const repeated = { ...def, ru: "нет и нет" };
  expect(legacyProjection(store, repeated, "ru").unresolved).toEqual([old]);
});
it("preview использует общий рендер и отвергает чужие кнопки/HTML/пример", () => {
  const def = getTemplate(key)!;
  const expected = messagePreview(undefined, def, "default");
  const actual = previewTemplate(actor, { key, example: "default" });
  expect(actual).toMatchObject({
    ru: expected.ru.text,
    kk: expected.kk.text,
    buttons_ru: expected.ru.buttons,
  });
  for (
    const extra of [
      { buttons_ru: { unknown: "X" } },
      { buttons_ru: { place: "<b>X</b>" } },
      { buttons_ru: { place: "{secret}" } },
      { example: "missing" },
    ]
  ) expect(() => previewTemplate(actor, { key, ...extra })).toThrow();
});
it("все примеры и кнопки ссылаются только на объявленные поля", () => {
  for (const def of TEMPLATE_CATALOG.filter((d) => !d.deprecated)) {
    const variables = new Set(def.variables.map((v) => v.name));
    for (const example of def.examples ?? []) {
      for (const lang of ["ru", "kk"] as const) {
        for (const name of Object.keys(example[lang])) {
          expect(variables.has(name), `${def.key}:${name}`).toBe(true);
        }
      }
      for (const row of example.buttons ?? []) {
        for (const button of row) {
          expect(
            def.buttons?.some((b) => b.id === button.id),
            `${def.key}/${button.id}`,
          ).toBe(true);
        }
      }
    }
  }
});
