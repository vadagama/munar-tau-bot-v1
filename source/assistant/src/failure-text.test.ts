// Тесты человекочитаемых описаний сбоев (решение владельца 26.10.2026):
// панель показывает развёрнутый текст «что случилось и что делать» вместо
// сырой причины Pi (no_model и т.п.).

import { expect, it } from "vitest";
import { describeFailure } from "./failure-text.ts";

it("без ключа провайдера объясняет настройку токена и секрета", () => {
  const text = describeFailure({ apiKeyPresent: false, reason: "no_model" });
  expect(text).toContain("токен провайдера");
  expect(text).toContain("ASSISTANT_API_KEY_SECRET");
  expect(text).toContain("Повторить");
  // Сырая причина no_model в этом случае — шум: она лишь следствие отсутствия ключа.
  expect(text).not.toContain("no_model");
});

it("с ключом разворачивает сырую причину и подсказывает повтор", () => {
  const text = describeFailure({ apiKeyPresent: true, reason: "provider rate limited" });
  expect(text).toContain("Причина: provider rate limited");
  expect(text).toContain("Повторить");
});

it("с ключом без причины даёт общий текст с подсказкой", () => {
  const text = describeFailure({ apiKeyPresent: true });
  expect(text).toContain("Повторить");
  expect(text).not.toContain("Причина:");
});

it("пустая причина считается отсутствием причины", () => {
  const text = describeFailure({ apiKeyPresent: true, reason: "   " });
  expect(text).not.toContain("Причина:");
});

it("длинная причина обрезается", () => {
  const text = describeFailure({ apiKeyPresent: true, reason: "x".repeat(500) });
  expect(text).toContain("Причина: ");
  expect(text.length).toBeLessThan(400);
});
