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
it("загружает прежние подписи меню одним запросом даже после сброса", async () => {
  let queries = 0;
  const store = await loadTemplateStore({
    query: async <T>(sql: string) => {
      queries++;
      expect(sql).toContain("historical_buttons");
      expect(sql).toContain(
        "'help.welcome_text','help.registration_help','help.worker_help'",
      );
      return [{
        key: "help.welcome_text",
        use_default: true,
        historical_buttons: [{
          ru: { newrequest: "Подать заявку" },
          kk: { newrequest: "Өтініш беру" },
        }],
      }] as T[];
    },
  });
  expect(queries).toBe(1);
  expect(store.get("help.welcome_text")?.historicalButtons?.[0]?.ru.newrequest)
    .toBe("Подать заявку");
});
