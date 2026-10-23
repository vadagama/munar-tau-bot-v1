import { describe, expect, it } from "vitest";
import { checkedDocumentSnapshot, type ObligationResult } from "./snapshot.ts";
const item: ObligationResult = { id: "ob", kind: "act", task_id: "task", document_id: "doc", document_version_id: "v1", state: "approved", signed_required: true, signed_attachment_id: "signed", task_report_id: "report", expected_report_id: "report", is_test: true, document_is_test: true, document_kind: "act", document_task_id: "task", request_id: null, document_request_id: null, prepared_by: "preparer", reviewer_id: "reviewer", document_prepared_by: "preparer", document_reviewer_id: "reviewer" };
describe("WRK-18: проверяемый комплект документов", () => {
  it("сохраняет конкретные версии, а не флаг approved клиента", () => {
    expect(checkedDocumentSnapshot([item], ["task"])).toEqual([{ requirement_id: "ob", document_id: "doc", document_version_id: "v1" }]);
  });
  it("не снимает обязательность акта без настройки", () => {
    expect(() => checkedDocumentSnapshot([], ["task"])).toThrow(/обязательн/);
  });
  it.each([
    { state: "needs_fix" }, { document_version_id: null }, { signed_attachment_id: null },
    { task_report_id: "previous" }, { document_is_test: false }, { document_kind: "receipt" },
    { document_task_id: "foreign" }, { document_reviewer_id: "other" },
  ])("отклоняет неподходящий комплект %j", patch => {
    expect(() => checkedDocumentSnapshot([{ ...item, ...patch }], ["task"])).toThrow();
  });
});
