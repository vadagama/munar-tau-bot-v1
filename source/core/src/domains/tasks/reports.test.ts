import { describe, expect, it } from "vitest";
import { reportInput } from "./reports.ts";
const body = {
  performed_work: " Работа ",
  performed_at: "2026-10-17T12:00:00+05:00",
  result: "Готово",
  limitations: "",
  evidence: [],
};
describe("WRK-16 HTTP-контракт отчёта", () => {
  it("нормализует часовой пояс и текст", () =>
    expect(reportInput(body)).toMatchObject({
      performedWork: "Работа",
      performedAt: "2026-10-17T07:00:00.000Z",
    }));
  it.each([
    null,
    {},
    [{ requirement_id: "photo", attachment_ids: "id" }],
    Array(31).fill({}),
  ])("отклоняет неверный evidence %j", (evidence) => {
    expect(() => reportInput({ ...body, evidence })).toThrow();
  });
  it("отклоняет повторное использование файла и превышение лимита", () => {
    for (
      const ids of [
        ["id", "id"],
        Array.from({ length: 11 }, (_, i) => String(i)),
      ]
    ) {
      expect(() =>
        reportInput({
          ...body,
          evidence: [{ requirement_id: "photo", attachment_ids: ids }],
        })
      ).toThrow();
    }
  });
  it("не угадывает часовой пояс выполнения", () =>
    expect(() => reportInput({ ...body, performed_at: "2026-10-17T12:00" }))
      .toThrow());
});
