import { expect, it } from "vitest";
import { auditButtonTemplates } from "./button-audit.ts";
it("active ru/kk defaults contain context without command instructions", () => {
  expect(auditButtonTemplates()).toEqual([]);
});
it("flags a legacy active override while leaving it and its history unchanged", () => {
  const override = { ru: "Обращения: /requests", kk: "Өтініштер: /requests" };
  const store = new Map([["help.registration_help", override]]);
  expect(auditButtonTemplates(store)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "help.registration_help",
        language: "ru",
      }),
    ]),
  );
  expect(store.get("help.registration_help")).toBe(override);
});

it.each(["/requests,", "(/requests)", "/requests.", "/sr"])(
  "detects a command next to punctuation: %s",
  (command) => {
    const store = new Map([["help.registration_help", {
      ru: "Обращения " + command,
      kk: "Өтініштер " + command,
    }]]);
    expect(auditButtonTemplates(store)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "help.registration_help",
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
      new Map([["help.registration_help", { ru: text, kk: text }]]),
    ),
  ).toEqual([]);
});
