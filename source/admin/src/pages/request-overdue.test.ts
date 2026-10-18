import { expect, it } from "vitest";
import { requestOverdue, requestOverdueDetails } from "./request-overdue";
const now = Date.parse("2026-10-18T08:00:00Z");
const past = "2026-10-18T07:00:00Z", future = "2026-10-18T09:00:00Z";
it("учитывает просрочку первого ответа до его получения", () => {
  expect(requestOverdue({ state: "new", first_response_due_at: past }, now)).toBe(true);
  expect(requestOverdue({ state: "reviewing", first_response_due_at: past, first_response_at: past }, now)).toBe(false);
  expect(requestOverdue({ state: "new", first_response_due_at: future }, now)).toBe(false);
});
it("учитывает действующий срок выполнения и непогашенный срок ответа в отсрочке", () => {
  expect(requestOverdue({ state: "in_work", due_at: past, first_response_at: past }, now)).toBe(true);
  expect(requestOverdue({ state: "on_hold", first_response_due_at: past, overdue_since: past }, now)).toBe(true);
  expect(requestOverdue({ state: "on_hold", overdue_since: past, first_response_at: past }, now)).toBe(false);
});
it("не помечает завершённые обращения и черновики текущей просрочкой", () => {
  for (const state of ["closed", "canceled", "rejected", "draft"]) {
    expect(requestOverdue({ state, overdue_since: past, due_at: past }, now)).toBe(false);
  }
  expect(requestOverdue({ state: "new", first_response_due_at: "bad-date" }, now)).toBe(false);
});

it("показывает срок первого ответа и текущую календарную просрочку", () => {
  expect(requestOverdueDetails({ state: "new", first_response_due_at: "2026-10-17T05:43:00Z" }, now))
    .toEqual(["Первый ответ просрочен на 1 д 2 ч 17 мин (календарное время). Срок: 17.10.2026, 10:43. Ответ ещё не дан."]);
});
it("после ответа историческая просрочка не считается текущей", () => {
  const row = { state: "reviewing", first_response_due_at: past, first_response_at: "2026-10-18T07:26:00Z", overdue_since: past };
  expect(requestOverdue(row, now)).toBe(false);
  expect(requestOverdueDetails(row, now)).toEqual([]);
  expect(requestOverdueDetails(row, now + 3600000)).toEqual([]);
});
it("время текущей просрочки растёт до исполнения обязательства", () => {
  const row = { state: "new", first_response_due_at: past };
  expect(requestOverdueDetails(row, now)[0]).toContain("на 1 ч");
  expect(requestOverdueDetails(row, now + 3600000)[0]).toContain("на 2 ч");
});
it("показывает только действующую просрочку выполнения после запоздалого ответа", () => {
  const row = { state: "in_work", first_response_due_at: past, first_response_at: "2026-10-18T07:26:00Z", overdue_since: past, due_at: past };
  expect(requestOverdueDetails(row, now)).toHaveLength(1);
  expect(requestOverdueDetails(row, now)[0]).toContain("Срок выполнения просрочен на 1 ч");
  expect(requestOverdue({ ...row, state: "awaiting_confirmation" }, now)).toBe(false);
});
it("разделяет сроки первого ответа и выполнения, не выдумывает отсутствующий срок", () => {
  expect(requestOverdueDetails({ state: "in_work", first_response_at: past, due_at: past }, now)).toEqual([
    "Срок выполнения просрочен на 1 ч (календарное время). Срок: 18.10.2026, 12:00.",
  ]);
  expect(requestOverdueDetails({ state: "new", first_response_due_at: future }, now)).toEqual([]);
  expect(requestOverdueDetails({ state: "closed", first_response_due_at: past }, now)).toEqual([]);
});
