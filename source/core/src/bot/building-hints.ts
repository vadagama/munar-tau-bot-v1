import { message, safeBlock } from "../templates/message.ts";
import type { TemplateStore } from "../templates/store.ts";
import type { Row } from "../domains/registry/validation.ts";
import { esc, type Lang } from "./text.ts";

export function houseChoice(input: string) {
  const match =
    /^\/start house_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{12})$/i
      .exec(input.trim());
  return match ? { id: match[1]!, token: match[2]! } : null;
}
export function validHouseChoice(
  state: Row,
  choice: ReturnType<typeof houseChoice>,
): boolean {
  return !!choice && state.scenario === "registration" &&
    state.step === "building" && state.house_choice_token === choice.token;
}
/** Клик по номеру помещения в подсказке: /start premise_<uuid>_<token>. */
export function premiseChoice(input: string) {
  const match =
    /^\/start premise_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{12})$/i
      .exec(input.trim());
  return match ? { id: match[1]!, token: match[2]! } : null;
}
export function validPremiseChoice(
  state: Row,
  choice: ReturnType<typeof premiseChoice>,
): boolean {
  return !!choice && state.scenario === "registration" &&
    state.step === "number" && state.premise_choice_token === choice.token;
}
export function buildingHints(
  rows: Row[],
  lang: Lang,
  token: string,
  store?: TemplateStore,
  botUsername = "munar_tau_user_bot",
): string {
  if (!rows.length) {
    return message(store, lang, "message.registration.buildings_empty");
  }
  const username = /^[a-zA-Z0-9_]{5,32}$/.test(botUsername)
    ? botUsername
    : "munar_tau_user_bot";
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const phase = typeof row.construction_phase === "number"
      ? row.construction_phase
      : 0;
    groups.set(phase, [...(groups.get(phase) ?? []), row]);
  }
  const collator = new Intl.Collator("ru", { numeric: true });
  const blocks = [...groups].sort(([a], [b]) => (a || 99) - (b || 99)).map(
    ([phase, houses]) => {
      const title = phase
        ? message(store, lang, "message.registration.building_phase", { phase })
        : message(store, lang, "message.registration.building_unassigned");
      const links = houses.sort((a, b) =>
        collator.compare(String(a.code), String(b.code))
      ).map((house) =>
        `<a href="https://t.me/${username}?start=house_${esc(house.id)}_${
          esc(token)
        }">${esc(house.code)}</a>`
      );
      return `<b>${title}</b>\n${links.join(", ")}`;
    },
  );
  return message(store, lang, "message.registration.building_unknown", {
    buildings: safeBlock(blocks.join("\n\n")),
  });
}
/**
 * Подсказка по помещениям выбранного типа в выбранном доме: кликабельные
 * номера (deep-link), по аналогии с домами по очередям.
 */
export function premiseHints(
  rows: Row[],
  lang: Lang,
  token: string,
  store?: TemplateStore,
  botUsername = "munar_tau_user_bot",
): string {
  const username = /^[a-zA-Z0-9_]{5,32}$/.test(botUsername)
    ? botUsername
    : "munar_tau_user_bot";
  const collator = new Intl.Collator("ru", { numeric: true });
  const links = rows.sort((a, b) =>
    collator.compare(String(a.number), String(b.number))
  ).map((premises) =>
    `<a href="https://t.me/${username}?start=premise_${esc(premises.id)}_${
      esc(token)
    }">${esc(premises.number)}</a>`
  );
  return message(store, lang, "message.registration.premise_unknown", {
    numbers: safeBlock(links.join(", ")),
  });
}
