import { expect, it } from "vitest";
import { makeTestActor } from "../testing/actors.ts";
import { can } from "../pdp/evaluate.ts";
import { previewTemplate } from "./service.ts";
it("только три роли имеют доступ, правка запрещена эмуляции", () => {
  for (const role of ["chairman", "administrator", "tech_admin"] as const) {
    expect(can(makeTestActor(role, []), "settings.templates.edit").allow).toBe(
      true,
    );
  }
  expect(can(makeTestActor("executor", []), "settings.templates.read").allow)
    .toBe(false);
  const actor = makeTestActor("administrator", []);
  actor.emulation = {
    sessionId: "s",
    realPersonId: "r",
    realProfileId: "p",
  } as typeof actor.emulation;
  expect(can(actor, "settings.templates.edit").allow).toBe(false);
});
it("предпросмотр проходит серверную проверку и валидацию", () => {
  const actor = makeTestActor("administrator", []);
  expect(
    previewTemplate(actor, {
      key: "errors.INTERNAL",
      text_ru: "Новый",
      text_kk: "Жаңа",
    }),
  ).toMatchObject({ ru: "Новый", kk: "Жаңа" });
  expect(() =>
    previewTemplate(actor, {
      key: "errors.INTERNAL",
      text_ru: "<script>x</script>",
      text_kk: "Жаңа",
    })
  ).toThrow();
  expect(() =>
    previewTemplate(makeTestActor("executor", []), { key: "errors.INTERNAL" })
  ).toThrow();
});
