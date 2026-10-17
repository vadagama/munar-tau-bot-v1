import { expect, it } from "vitest";
import { preview, requestCardText, requestListText } from "./request-text.ts";
import { replyText } from "./keyboard.ts";

it("длинная история и список помещаются в sendMessage и предлагают следующую страницу", () => {
  const rows = Array.from(
    { length: 20 },
    (_, i) => ({
      number: `З-26-${i}`,
      state: "awaiting_confirmation",
      author_person_id: "author",
      description: "Длинный текст ".repeat(1000),
    }),
  );
  const reply = requestListText(rows, "author", 1);
  const text = replyText(reply);
  expect(text.length).toBeLessThanOrEqual(4000);
  expect(text).toContain("/requests page:2");
  expect(text).not.toContain("З-26-19");
  // Кнопка пагинации — текстовый эквивалент команды /requests page:2.
  expect(typeof reply === "object" && reply.buttons?.[0]?.[0]?.data).toBe(
    "/requests page:2",
  );
  const cardReply = requestCardText({
    ...rows[0]!,
    confirmation_version: 2,
    messages: Array.from(
      { length: 20 },
      () => ({ channel: "resident", text: "Сообщение ".repeat(1000) }),
    ),
  });
  expect(replyText(cardReply).length).toBeLessThanOrEqual(4000);
  expect(replyText(cardReply)).toContain("Версия результата");
});

it("превью не обрывает emoji на половине UTF-16 пары", () => {
  expect(preview("🙂🙂🙂", 4)).toBe("🙂…");
});

it("карточка показывает действия по состоянию и экранирует пользовательский текст", () => {
  const card = requestCardText({
    number: "З-26-1",
    state: "awaiting_confirmation",
    author_person_id: "author",
    description: "Описание с <b>разметкой</b> & кавычками",
    confirmation_version: 1,
    messages: [],
  });
  const text = replyText(card);
  expect(text).toContain("<b>З-26-1</b>");
  expect(text).toContain("&lt;b&gt;разметкой&lt;/b&gt;");
  expect(text).not.toContain("<b>разметкой");
  expect(text).toContain("/confirm НОМЕР ВЕРСИЯ");
  expect(text).toContain("Действия");
  // Кнопка подтверждения — точная команда с версией результата.
  expect(
    typeof card === "object" && card.buttons?.[0]?.[0]?.data,
  ).toBe("/confirm З-26-1 1");
});

it("закрытая карточка предлагает оценку кнопками 1–5 с командой /rate", () => {
  const card = requestCardText({
    number: "З-26-7",
    state: "closed",
    author_person_id: "author",
    description: "Готово",
    confirmation_version: 3,
    messages: [],
  });
  const data = typeof card === "object"
    ? (card.buttons?.[0] ?? []).map((b) => b.data)
    : [];
  expect(data).toEqual([
    "/rate З-26-7 1",
    "/rate З-26-7 2",
    "/rate З-26-7 3",
    "/rate З-26-7 4",
    "/rate З-26-7 5",
  ]);
});

it("черновик в списке получает подсказку отправки", () => {
  const text = replyText(
    requestListText(
      [{ number: null, state: "draft", author_person_id: "author", description: "d" }],
      "author",
      1,
    ),
  );
  expect(text).toContain("Черновик");
  expect(text).not.toContain(" / ");
  expect(text).toContain("/sendrequest");
});
