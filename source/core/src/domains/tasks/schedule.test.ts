import { expect, it } from "vitest";
import { scheduleInput } from "./schedule.ts";
it("расписание требует явных дат и длительностей", () => {
  const input = {
    enabled: true,
    next_run_at: "2026-10-18T08:00:00+05:00",
    interval_hours: 24,
    due_hours: 8,
  };
  expect(scheduleInput(input)).toMatchObject({
    intervalHours: 24,
    dueHours: 8,
    next: new Date("2026-10-18T03:00:00Z"),
  });
  for (
    const bad of [
      { ...input, interval_hours: 0 },
      { ...input, due_hours: 1.5 },
      { ...input, next_run_at: "invalid" },
      { ...input, next_run_at: "2026-10-18T08:00:00" },
      { ...input, enabled: "true" },
    ]
  ) expect(() => scheduleInput(bad)).toThrow();
});
