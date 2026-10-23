import { describe, expect, it } from "vitest";
import { documentTransition } from "./fsm.ts";

describe("WRK-17/18: проверка неизменяемой версии", () => {
  it("проверяет либо возвращает направленный документ", () => {
    expect(documentTransition("draft", "submit")).toBe("on_review");
    expect(documentTransition("on_review", "approve")).toBe("approved");
    expect(documentTransition("on_review", "return")).toBe("returned");
    expect(documentTransition("approved", "needs_fix")).toBe("needs_fix");
  });
  it.each(["returned", "needs_fix", "approved"])("исправление %s требует новой версии", state => {
    expect(() => documentTransition(state, "submit")).toThrow();
    expect(() => documentTransition(state, "approve")).toThrow();
  });
  it("не допускает самопроверку черновика и неизвестные действия", () => {
    expect(() => documentTransition("draft", "approve")).toThrow();
    expect(() => documentTransition("draft", "publish")).toThrow();
    expect(() => documentTransition("on_review", "needs_fix")).toThrow();
  });
});
