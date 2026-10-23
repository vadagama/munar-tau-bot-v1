import { expect, it } from "vitest";
import { documentRulesInput } from "./rules.ts";
const rule = { kind: "act", phase: "before_acceptance", basis: "Регламент работ", prepared_by: "44444444-4444-4444-4444-444444444402", reviewer_id: "44444444-4444-4444-4444-444444444401", signed_required: true };
it("сохраняет декларативное требование в версии методички без произвольного срока", () => {
  expect(documentRulesInput([{ ...rule, due_at: "2030-01-01", approved: true }])).toEqual([rule]);
  expect(documentRulesInput(undefined)).toEqual([]);
});
it.each([[rule, rule], [{ ...rule, prepared_by: rule.reviewer_id }], [{ ...rule, kind: "unknown" }], [{ ...rule, reviewer_id: "uuid" }], [null]].map(rules => ({ rules })))("не принимает неоднозначные и некорректные требования $rules", ({ rules }) => {
  expect(() => documentRulesInput(rules)).toThrow();
});
