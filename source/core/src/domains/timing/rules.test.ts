import { describe, expect, it } from "vitest";
import { scheduleParams, validateRuleChange } from "./rules.ts";
const base = {
  hours: 12,
  clock: "working" as const,
  start: 8,
  end: 20,
  timezone: "Asia/Almaty",
  days: [0, 1, 2, 3, 4, 5, 6],
};
describe("TIM-03/04/07", () => {
  it("меняет график независимо от длительности", () => {
    const next = scheduleParams(base, { ...base, hours: 9, start: 9, end: 18 });
    expect(next).toMatchObject({ hours: 12, start: 9, end: 18 });
    expect(base.start).toBe(8);
  });
  it("календарный срок не зависит от смены", () => {
    expect(scheduleParams({ hours: 48, clock: "calendar" }, base)).toEqual({
      hours: 48,
      clock: "calendar",
    });
  });
  it("отклоняет неверные дни, часовой пояс и недопустимые значения", () => {
    for (
      const p of [
        { ...base, days: [] },
        { ...base, start: NaN },
        { ...base, timezone: "invalid" },
        { ...base, hours: 0 },
        { ...base, clock: "invalid" },
      ]
    ) {
      expect(() => validateRuleChange("operational", null, p)).toThrow();
    }
  });
  it("правовой срок нельзя изменить без заполненных границ", () => {
    expect(() => validateRuleChange("legal", null, base)).toThrowError(
      expect.objectContaining({ code: "RULE_LEGAL_BOUNDARY" }),
    );
  });
  it("правовые границы проверяются вместе со способом отсчёта", () => {
    const limits = {
      min_hours: 2,
      max_hours: 12,
      clock: "working" as const,
      start: 8,
      end: 20,
      timezone: "Asia/Almaty",
      days: [0, 1, 2, 3, 4, 5, 6],
    };
    expect(() => validateRuleChange("legal", limits, base)).not.toThrow();
    for (
      const p of [{ ...base, hours: 13 }, { ...base, clock: "calendar" }, {
        ...base,
        start: 9,
      }]
    ) {
      expect(() => validateRuleChange("legal", limits, p)).toThrowError(
        expect.objectContaining({ code: "RULE_LEGAL_BOUNDARY" }),
      );
    }
  });
});
