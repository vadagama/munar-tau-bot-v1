import { getTemplate } from "../templates/catalog/index.ts";
import { messagePreview } from "../templates/message.ts";
import { expect, it } from "vitest";
import {
  buildingHints,
  houseChoice,
  premiseChoice,
  premiseHints,
  validHouseChoice,
  validPremiseChoice,
} from "./building-hints.ts";
const id = "00000000-0000-4000-8000-000000000001", token = "123456abcdef";
it.each(["ru", "kk"] as const)(
  "дома сгруппированы и отсортированы, ссылки экранированы (%s)",
  (lang) => {
    const text = buildingHints(
      [
        { id, code: "103/1", construction_phase: 2 },
        { id, code: "102/10", construction_phase: 1 },
        { id, code: "102/2", construction_phase: 1 },
        { id, code: "<Дом & 1>", construction_phase: null },
      ],
      lang,
      token,
    );
    expect(text.indexOf("102/2")).toBeLessThan(text.indexOf("102/10"));
    expect(text.indexOf("102/10")).toBeLessThan(text.indexOf("103/1"));
    expect(text).toContain(
      lang === "ru" ? "<b>Очередь 1</b>" : "<b>1-кезек</b>",
    );
    expect(text).toContain(
      lang === "ru" ? "Очередь не указана" : "Кезек көрсетілмеген",
    );
    expect(text).toContain(
      `href="https://t.me/munar_tau_user_bot?start=house_${id}_${token}"`,
    );
    expect(text).toContain("&lt;Дом &amp; 1&gt;");
  },
);
it("пустой каталог и ссылка только текущего выбора", () => {
  expect(buildingHints([], "ru", token)).toContain("Дома пока не добавлены");
  const choice = houseChoice(`/start house_${id}_${token}`);
  expect(
    validHouseChoice({
      scenario: "registration",
      step: "building",
      house_choice_token: token,
    }, choice),
  ).toBe(true);
  for (
    const state of [
      { scenario: "requests", step: "building", house_choice_token: token },
      { scenario: "registration", step: "kind", house_choice_token: token },
      {
        scenario: "registration",
        step: "building",
        house_choice_token: "other",
      },
      {},
    ]
  ) expect(validHouseChoice(state, choice)).toBe(false);
  expect(houseChoice(`/start house_${id}`)).toBeNull();
});

it.each(["ru", "kk"] as const)(
  "превью подсказки соответствует сценарию (%s)",
  (lang) => {
    expect(
      buildingHints(
        [{ id, code: "102/1", construction_phase: 1 }],
        lang,
        token,
      ),
    ).toBe(
      messagePreview(
        undefined,
        getTemplate("message.registration.building_unknown")!,
      )[lang].text,
    );
  },
);

it.each(["ru", "kk"] as const)(
  "номера помещений отсортированы естественно, ссылки экранированы (%s)",
  (lang) => {
    const text = premiseHints(
      [
        { id, number: "10" },
        { id, number: "2" },
        { id, number: "<1 & 2>" },
      ],
      lang,
      token,
    );
    expect(text.indexOf("2</a>")).toBeLessThan(text.indexOf("10</a>"));
    expect(text).toContain(
      `href="https://t.me/munar_tau_user_bot?start=premise_${id}_${token}"`,
    );
    expect(text).toContain("&lt;1 &amp; 2&gt;");
    expect(text).toContain(
      lang === "ru" ? "Помещение не найдено" : "Нысан табылмады",
    );
  },
);

it("ссылка помещения только текущего выбора", () => {
  const choice = premiseChoice(`/start premise_${id}_${token}`);
  expect(
    validPremiseChoice({
      scenario: "registration",
      step: "number",
      premise_choice_token: token,
    }, choice),
  ).toBe(true);
  for (
    const state of [
      { scenario: "requests", step: "number", premise_choice_token: token },
      { scenario: "registration", step: "role", premise_choice_token: token },
      {
        scenario: "registration",
        step: "number",
        premise_choice_token: "other",
      },
      {},
    ]
  ) expect(validPremiseChoice(state, choice)).toBe(false);
  expect(premiseChoice(`/start premise_${id}`)).toBeNull();
});

it.each(["ru", "kk"] as const)(
  "превью подсказки помещений соответствует сценарию (%s)",
  (lang) => {
    expect(
      premiseHints([
        { id, number: "4" },
        { id, number: "5" },
        { id, number: "6" },
      ], lang, token),
    ).toBe(
      messagePreview(
        undefined,
        getTemplate("message.registration.premise_unknown")!,
      )[lang].text,
    );
  },
);
