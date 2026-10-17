import { describe, expect, it } from "vitest";
import { validateEvidenceAcceptance, validateReport, type WorkReport } from "./report.ts";

const requirements = [{ id: "photo", required: true }, { id: "extra", required: false }];
const report: WorkReport = {
  performedWork: "Заменён кран", performedAt: "2026-10-17T10:00:00+05:00",
  result: "Протечка устранена", limitations: "", evidence: [],
};
describe("VS-4 WRK-16: отчёт и обязательные доказательства", () => {
  it("принимает проверенный файл; необязательное доказательство не требует объяснения", () => {
    expect(validateReport({ ...report, evidence: [
      { requirementId: "photo", attachmentIds: ["file"] },
    ] }, requirements, new Set(["file"]))).toEqual([]);
  });
  it("не принимает ошибку загрузки за доказательство", () => {
    expect(() => validateReport({ ...report, evidence: [
      { requirementId: "photo", attachmentIds: ["failed-upload"], missingReason: "Ошибка" },
    ] }, requirements, new Set())).toThrow();
  });
  it("разрешает отправку без доказательства только с объяснением", () => {
    expect(() => validateReport(report, requirements, new Set())).toThrow();
    expect(validateReport({ ...report, evidence: [
      { requirementId: "photo", attachmentIds: [], missingReason: "Камера сломана" },
    ] }, requirements, new Set())).toEqual(["photo"]);
  });
  it.each(["performedWork", "result", "performedAt"] as const)("требует поле %s", (field) => {
    expect(() => validateReport({ ...report, [field]: " " }, [], new Set())).toThrow();
  });
  it("не принимает некорректное время", () => {
    expect(() => validateReport({ ...report, performedAt: "invalid" }, [], new Set())).toThrow();
  });
  it("отклоняет неизвестные и повторные пункты", () => {
    const evidence = { requirementId: "extra", attachmentIds: [] };
    expect(() => validateReport({ ...report, evidence: [evidence] }, [], new Set())).toThrow();
    expect(() => validateReport({ ...report, evidence: [evidence, evidence] }, requirements, new Set()))
      .toThrow();
  });
  it("приёмка требует явного решения по каждому отсутствующему доказательству", () => {
    expect(() => validateEvidenceAcceptance(["photo"], [])).toThrow();
    expect(() => validateEvidenceAcceptance(["photo"], [{ requirementId: "photo", reason: " " }]))
      .toThrow();
    expect(() => validateEvidenceAcceptance(["photo"], [
      { requirementId: "photo", reason: "Проверено при осмотре" },
    ])).not.toThrow();
  });
  it("не принимает решение о другом доказательстве или повторное решение", () => {
    const decision = { requirementId: "other", reason: "Проверено" };
    expect(() => validateEvidenceAcceptance(["photo"], [decision])).toThrow();
    expect(() => validateEvidenceAcceptance(["other"], [decision, decision])).toThrow();
  });
});
