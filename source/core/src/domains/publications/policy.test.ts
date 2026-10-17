import { expect, it } from "vitest";
import { validatePublicationRelease } from "./policy.ts";
it("FIN/PUB: публикация не заменяет утверждённый документ", () => {
  expect(() =>
    validatePublicationRelease({
      kind: "financial_report",
      requires_document: false,
      approved_by: "chair",
      documentApproved: false,
    })
  ).toThrow();
  expect(() =>
    validatePublicationRelease({
      kind: "announcement",
      requires_document: true,
      documentApproved: false,
    })
  ).toThrow();
});
it("отчёт требует принятой общей работы", () => {
  expect(() =>
    validatePublicationRelease({ kind: "work_report", workCompleted: false })
  ).toThrow();
  expect(() =>
    validatePublicationRelease({ kind: "work_report", workCompleted: true })
  ).not.toThrow();
});
it("обычное объявление публикуется без финансового согласования", () => {
  expect(() => validatePublicationRelease({ kind: "announcement" })).not
    .toThrow();
});
