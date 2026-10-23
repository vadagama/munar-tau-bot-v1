import { describe, expect, it } from "vitest";
import { documentInput, versionInput } from "./input.ts";
const body = {
  title: " Акт работы ", kind: "act", audience: "staff", building_ids: ["b1"],
  prepared_by: "p", reviewer_id: "r", document_date: "2026-10-23", parties: "ОСИ",
};
describe("WRK-17: контракт документа", () => {
  it("сохраняет метаданные без подмены версии или утверждения", () => {
    expect(documentInput({ ...body, approved: true })).toMatchObject({ title: "Акт работы", kind: "act" });
    expect(documentInput({ ...body, approved: true })).not.toHaveProperty("approved");
  });
  it.each([
    { kind: "unknown" }, { audience: "everyone" }, { document_date: "2026-02-30" },
    { building_ids: ["b1", "b1"] }, { building_ids: "b1" },
    { task_id: "t", request_id: "r" }, { kind: "receipt", audience: "resident" },
  ])("отклоняет некорректные данные %j", patch => {
    expect(() => documentInput({ ...body, ...patch })).toThrow();
  });
  it("подписанный экземпляр требует способа и основания проверки", () => {
    expect(() => versionInput({ attachment_id: "a", signed_attachment_id: "s" })).toThrow();
    expect(() => versionInput({ attachment_id: "a", signed_attachment_id: "a", signature_method: "Визуально", signature_basis: "Оригинал" })).toThrow();
    expect(versionInput({ attachment_id: "a", signed_attachment_id: "s", signature_method: "Оригинал", signature_basis: "Проверено лично" })).toMatchObject({ signed_attachment_id: "s" });
  });
});
