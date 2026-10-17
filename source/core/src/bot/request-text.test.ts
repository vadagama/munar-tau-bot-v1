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
  const text = requestListText(rows, "author", 1, "Справка");
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
  }, "Справка");
  expect(card.length).toBeLessThanOrEqual(4000);
  expect(card).toContain("Версия результата");
});
it("превью не обрывает emoji на половине UTF-16 пары", () => {
  expect(preview("🙂🙂🙂", 4)).toBe("🙂…");
});
