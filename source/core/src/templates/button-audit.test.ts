import { expect, it } from "vitest";
import { auditButtonTemplates } from "./button-audit.ts";
it("active ru/kk defaults contain context without command instructions", () => {
  expect(auditButtonTemplates()).toEqual([]);
});
it("flags a legacy active override while leaving it and its history unchanged", () => {
  const override = { ru: "Обращения: /requests", kk: "Өтініштер: /requests" };
  const store = new Map([["help.welcome_text", override]]);
  expect(auditButtonTemplates(store)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "help.welcome_text",
        language: "ru",
      }),
    ]),
  );
  expect(store.get("help.welcome_text")).toBe(override);
});

it.each(["/requests,", "(/requests)", "/requests.", "/sr"])(
  "detects a command next to punctuation: %s",
  (command) => {
    const store = new Map([["help.welcome_text", {
      ru: "Обращения " + command,
      kk: "Өтініштер " + command,
    }]]);
    expect(auditButtonTemplates(store)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "help.welcome_text",
          language: "ru",
        }),
      ]),
    );
  },
);

it("keeps HTML context and ordinary links out of command detection", () => {
  const text =
    '<b>Инструкция</b> <a href="https://example.com/requests">Подробнее</a> https://example.com/help';
  expect(
    auditButtonTemplates(
      new Map([["help.welcome_text", { ru: text, kk: text }]]),
    ),
  ).toEqual([]);
});

it.each(["help.registration_help", "help.worker_help"])("разрешает команды в справке %s", key => {
  expect(auditButtonTemplates(new Map([[key, { ru: "/help — Справка", kk: "/help — Анықтама" }]]))).toEqual([]);
});
