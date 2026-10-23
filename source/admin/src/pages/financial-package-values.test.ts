import { expect, it } from "vitest";
import { financialEditValues, financialPublicationValues } from "./financial-package-values";
it("исправление восстанавливает текущий комплект и отделяет новое публичное пояснение", () => {
  const card = { state: "published", financial_version_id: "current", financial_versions: [{ id: "old", obligation_id: "wrong" }, { id: "current", obligation_id: "duty", period_from: "2026-09-01", period_to: "2026-09-30", correction_note: "Прежнее пояснение", documents: [
    { code: "report", document_version_id: "report", disclosed: true }, { code: "council", document_version_id: "basis", disclosed: true }, { code: "review", document_version_id: "private", disclosed: false },
  ] }] };
  expect(financialEditValues(card)).toEqual({ obligation_id: "duty", period_from: "2026-09-01", period_to: "2026-09-30", report_version_id: "report", basis_versions: [{ code: "council", document_version_id: "basis" }, { code: "review", document_version_id: "private" }], disclosed_version_ids: ["basis"], correction_note: "" });
  expect(financialPublicationValues({ kind: "financial_report", report_version_id: "report", disclosed_version_ids: ["basis"], reason: "Служебное основание", correction_note: "Публичная поправка" })).toMatchObject({ requires_document: true, disclosed_version_ids: ["report", "basis"], reason: "Служебное основание", correction_note: "Публичная поправка" });
});
