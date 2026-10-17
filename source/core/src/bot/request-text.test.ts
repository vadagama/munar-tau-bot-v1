import { expect, it } from "vitest";
import { preview, requestCardText, requestListText } from "./request-text.ts";

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
  const text = requestListText(rows, "author", 1);
  expect(text.length).toBeLessThanOrEqual(4000);
  expect(text).toContain("/requests page:2");
  expect(text).not.toContain("З-26-19");
  const card = requestCardText({
    ...rows[0],
    confirmation_version: 2,
    messages: Array.from(
      { length: 20 },
      () => ({ channel: "resident", text: "Сообщение ".repeat(1000) }),
    ),
  });
  expect(card.length).toBeLessThanOrEqual(4000);
  expect(card).toContain("Версия результата");
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
  expect(card).toContain("<b>З-26-1</b>");
  expect(card).toContain("&lt;b&gt;разметкой&lt;/b&gt;");
  expect(card).not.toContain("<b>разметкой");
  expect(card).toContain("/confirm НОМЕР ВЕРСИЯ");
  expect(card).toContain("Действия");
});

it("черновик в списке получает подсказку отправки", () => {
  const text = requestListText(
    [{ number: null, state: "draft", author_person_id: "author", description: "d" }],
    "author",
    1,
  );
  expect(text).toContain("Черновик / Жоба");
  expect(text).toContain("/sendrequest");
});
