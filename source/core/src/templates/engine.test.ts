import { expect, it } from "vitest";
import { renderTemplate, validateTemplate } from "./engine.ts";
it("подставляет безопасный текст, сохраняя emoji, переносы и неизвестные токены", () => {
  expect(renderTemplate("✅ {name}\n{missing} {12}", { name: "<b>A & B</b>" }))
    .toBe("✅ &lt;b&gt;A &amp; B&lt;/b&gt;\n{missing} {12}");
});
it("принимает разрешённую сбалансированную разметку", () => {
  expect(
    validateTemplate(
      '<b>{name}</b> <a href="https://example.org">ссылка</a> <tg-spoiler>текст</tg-spoiler>',
      ["name"],
    ),
  ).toEqual([]);
});
it.each([
  "<script>x</script>",
  "<b><i>x</b></i>",
  '<a href="javascript:alert(1)">x</a>',
  '<b onclick="x">x</b>',
  '<a href="https://x/{name}">x</a>',
  "<b>x",
  "{unknown}",
  "x".repeat(4001),
  "",
])("отклоняет опасный или невалидный шаблон %s", (text) => {
  expect(validateTemplate(text, ["name"]).length).toBeGreaterThan(0);
});
