// Тесты прав на разделы кабинета. Сервер всё равно проверяет PDP на каждый
// запрос (ROL-01) — эти флаги только скрывают пункты меню.

import { describe, expect, it } from "vitest";

import { canSeeAudit, canSeeTasks, canUseEmulation } from "./identity";

describe("canSeeAudit (AUD-02)", () => {
  it.each<[string[], boolean]>([
    [["chairman"], true],
    [["administrator"], true],
    [["tech_admin"], true],
    [["executor"], false],
    [["finance"], false],
    [[], false],
  ])("%j → %p", (roles, expected) => {
    expect(canSeeAudit(roles)).toBe(expected);
  });
});

describe("canUseEmulation (раздел 10.8 HLD)", () => {
  it.each<[string[], boolean]>([
    [["tech_admin"], true],
    [["chairman"], false],
    [["administrator"], false],
    [[], false],
  ])("%j → %p", (roles, expected) => {
    expect(canUseEmulation(roles)).toBe(expected);
  });
});

describe("canSeeTasks (ROL-02e)", () => {
  it.each(["chairman", "administrator", "deputy", "executor", "duty", "doc_reviewer", "finance", "tech_admin"])("%s видит задания", role => {
    expect(canSeeTasks([role])).toBe(true);
  });
  it("житель не видит раздел заданий", () => {
    expect(canSeeTasks([])).toBe(false);
  });
});
