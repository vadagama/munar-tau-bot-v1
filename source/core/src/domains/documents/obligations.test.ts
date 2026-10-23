import { describe, expect, it } from "vitest";
import { obligationInput } from "./obligations.ts";
const input = { task_id: "t", kind: "act", phase: "before_acceptance", basis: "Регламент ОСИ", prepared_by: "p", reviewer_id: "r", signed_required: true };
describe("WRK-18: обязанность имеет основание, ответственных и этап", () => {
  it("принимает явный комплект и не принимает срок от клиента вместо TIM", () => {
    const value = obligationInput({ ...input, due_at: "2099-01-01" });
    expect(value).toMatchObject(input);
    expect(value).not.toHaveProperty("due_at");
  });
  it.each([{ basis: "" }, { phase: "any" }, { kind: "unknown" }, { request_id: "r" }, { prepared_by: "r" }, { signed_required: "true" }])("отклоняет %j", patch => {
    expect(() => obligationInput({ ...input, ...patch })).toThrow();
  });
});
