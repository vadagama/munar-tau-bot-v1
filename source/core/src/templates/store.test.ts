import { expect, it } from "vitest";
import { loadTemplateStore, t } from "./store.ts";
import { FRIENDLY } from "./catalog/errors.ts";
it("все исходные ошибки совпадают побайтно без настроек", () => {
  for (const [code, text] of Object.entries(FRIENDLY)) {
    for (const lang of ["ru", "kk"] as const) {
      expect(t(undefined, lang, `errors.${code}`)).toBe(text[lang]);
    }
  }
});
it("сброс использует кодовый дефолт, удалённые ключи игнорируются", async () => {
  const store = await loadTemplateStore({
    query: async <T>() =>
      [
        {
          key: "errors.INTERNAL",
          text_ru: "Новый",
          text_kk: "Жаңа",
          use_default: false,
        },
        { key: "errors.FORBIDDEN", use_default: true },
        { key: "removed", use_default: false },
      ] as T[],
  });
  expect(t(store, "ru", "errors.INTERNAL")).toBe("Новый");
  expect(t(store, "kk", "errors.FORBIDDEN")).toBe(FRIENDLY.FORBIDDEN!.kk);
  expect(store.has("removed")).toBe(false);
});
