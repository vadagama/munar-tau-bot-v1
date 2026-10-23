import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { getTemplate, TEMPLATE_CATALOG } from "./catalog/index.ts";
import { validateTemplate } from "./engine.ts";
import { t } from "./store.ts";
// Независимые снимки литералов до переноса, включая полные разделы справки.
for (const file of readdirSync(new URL("./fixtures/", import.meta.url))) {
  it("golden: " + file, () => {
    const fixtures = JSON.parse(
      readFileSync(new URL("./fixtures/" + file, import.meta.url), "utf8"),
    ) as { key: string; ru: string; kk: string }[];
    for (const fixture of fixtures) {
      for (const lang of ["ru", "kk"] as const) {
        expect(getTemplate(fixture.key)?.[lang], fixture.key).toBe(
          fixture[lang],
        );
        expect(t(undefined, lang, fixture.key), fixture.key).toBe(
          fixture[lang],
        );
      }
    }
  });
}
it("ключи уникальны, дефолты валидны, переменные описаны", () => {
  expect(new Set(TEMPLATE_CATALOG.map((t) => t.key)).size).toBe(
    TEMPLATE_CATALOG.length,
  );
  for (const def of TEMPLATE_CATALOG) {
    for (const lang of ["ru", "kk"] as const) {
      expect(
        validateTemplate(
          def[lang],
          def.variables.map((v) => v.name),
        ),
        def.key + " " + lang,
      ).toEqual([]);
    }
  }
});

it("активные диалоги VS-8 доступны редактору каталога",()=>{
 for(const key of ["reports.mywork","reports.plans","polls.controls","initiatives.controls"]){expect(getTemplate(key),key).toBeDefined();expect(getTemplate(key)?.deprecated,key).not.toBe(true);}
});
