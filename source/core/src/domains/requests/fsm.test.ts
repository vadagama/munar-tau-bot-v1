import { describe, expect, it } from "vitest";
import { checkVersion, nextState, type RequestState } from "./fsm.ts";
describe("VS-3 FLOW/REQ: переходы обращения", () => {
  it.each([
    ["draft", "submit", "new"],
    ["new", "start_review", "reviewing"],
    ["reviewing", "ask_clarification", "need_clarification"],
    ["need_clarification", "answer_clarification", "reviewing"],
    ["reviewing", "start_work", "in_work"],
    ["in_work", "hold", "on_hold"],
    ["on_hold", "resume", "reviewing"],
    ["reviewing", "submit_result", "awaiting_confirmation"],
    ["awaiting_confirmation", "confirm_result", "closed"],
    ["closed", "reopen", "rework"],
    ["rework", "plan_rework", "in_work"],
    ["rejected", "uphold_appeal", "reviewing"],
  ])(
    "%s + %s → %s",
    (state, action, target) =>
      expect(nextState(state as RequestState, action)).toBe(target),
  );
  it("молчание и таймер не закрывают обращение", () => {
    expect(() => nextState("awaiting_confirmation", "timeout")).toThrow();
    expect(() => nextState("need_clarification", "admin_close")).toThrow();
  });
  it("отмена и отказ не возобновляются произвольным переходом", () => {
    expect(() => nextState("canceled", "start_review")).toThrow();
    expect(() => nextState("rejected", "start_work")).toThrow();
  });
  it("конкурирующая запись возвращает 409", () => {
    expect(() => checkVersion(3, 2)).toThrow(
      expect.objectContaining({ code: "CONCURRENT_MODIFICATION", status: 409 }),
    );
    expect(() => checkVersion(3, undefined)).toThrow();
    expect(() => checkVersion(3, 3)).not.toThrow();
  });
});
