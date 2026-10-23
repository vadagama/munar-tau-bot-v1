import { expect, it } from "vitest";
import { financialInput, financialRuleInput, checkedFinancialPackage } from "./financial.ts";
const report = "11111111-1111-4111-8111-111111111111", basis = "22222222-2222-4222-8222-222222222222", building = "33333333-3333-4333-8333-333333333333";
const rule = { name: "Месячный отчёт", form: "monthly", form_description: "Форма ОСИ", building_ids: [building], prepared_by: report, reviewer_id: basis, publisher_id: report,
  required_agreements: [{ code: "council", label: "Согласование совета", kind: "decision_basis", signed_required: true }], channels: ["bot", "noticeboard"], report_signed_required: true };
const input = { obligation_id: basis, period_from: "2026-09-01", period_to: "2026-09-30", report_version_id: report,
  basis_versions: [{ code: "council", document_version_id: basis }], disclosed_version_ids: [report], correction_note: "Исправлен период" };
it("финансовая версия ссылается на конкретные версии и не принимает флаг разрешения клиента", () => {
  expect(financialInput({ ...input, approved_by: "fake", approved: true })).toEqual(input);
  expect(financialInput({ ...input, correction_note: "" }).correction_note).toBe("");
});
it.each([{ period_from: "2026-02-31" }, { period_to: "2026-08-31" }, { disclosed_version_ids: [basis] }, { basis_versions: [{ code: "council", document_version_id: report }] }])("отклоняет противоречивый период или комплект %j", patch => {
  expect(() => financialInput({ ...input, ...patch })).toThrow();
});
it("регламент фиксирует форму, сотрудников, согласования и каждый канал", () => {
  expect(financialRuleInput({ ...rule, hours: 1 })).toEqual(rule);
  for (const patch of [{ channels: [] }, { required_agreements: [] }, { reviewer_id: report }, { form: "unknown" }, { required_agreements: [{ ...rule.required_agreements[0], code: "report" }] }]) expect(() => financialRuleInput({ ...rule, ...patch })).toThrow();
});
it("комплект требует действительных оснований, подписей и полного охвата", () => {
  const documents = [{ id: report, document_id: "report", kind: "financial_report", state: "approved", is_test: true, audience: "owner", building_ids: [building], signed_attachment_id: "signed-report", prepared_by: report, reviewer_id: basis },
    { id: basis, document_id: "basis", kind: "decision_basis", state: "approved", is_test: true, audience: "finance", building_ids: [building], signed_attachment_id: "signed-basis", prepared_by: report, reviewer_id: basis }];
  const context = { buildingIds: [building], isTest: true, rule: financialRuleInput(rule), periodFrom: input.period_from, periodTo: input.period_to };
  expect(checkedFinancialPackage(financialInput(input), documents, context)).toMatchObject({ report_version_id: report });
  for (const patch of [{ state: "needs_fix" }, { signed_attachment_id: null }, { building_ids: ["b2"] }, { is_test: false }]) {
    expect(() => checkedFinancialPackage(financialInput(input), [documents[0]!, { ...documents[1]!, ...patch }], context)).toThrow();
  }
  expect(() => checkedFinancialPackage(financialInput({ ...input, disclosed_version_ids: [report, basis] }), documents, context)).toThrow();
  expect(() => checkedFinancialPackage(financialInput({ ...input, period_to: "2026-10-31" }), documents, context)).toThrow();
});
