import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FinancialArchive } from "./financial-archive";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("после создания исправления раскрывает новый комплект", () => {
  const first = { id: "v1", version: 1, title: "Первый отчёт", body: "Прежние данные", period_from: "2026-09-01", period_to: "2026-09-30", published_at: "date", replaced_at: null, approved: true, needs_fix: false, correction_note: "", documents: [] };
  const { rerender } = render(<FinancialArchive publicationId="pub" onError={vi.fn()} versions={[first]} />);
  rerender(<FinancialArchive publicationId="pub" onError={vi.fn()} versions={[{ ...first, id: "v2", version: 2, title: "Исправленный отчёт", body: "Новый комплект", published_at: null, approved: false }, first]} />);
  expect(screen.getByText("Новый комплект")).toBeInTheDocument();
});
it("показывает точную версию, пояснение и предупреждение без действий утверждения", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Файл недоступен"));
  const fail = vi.fn();
  render(<FinancialArchive publicationId="pub" onError={fail} versions={[{ id: "v2", version: 2, title: "Отчёт", body: "Итоги", period_from: "2026-09-01", period_to: "2026-09-30", published_at: "date", replaced_at: null, approved: true, needs_fix: true, correction_note: "Исправлена сумма", documents: [{ document_version_id: "d2", title: "Подписанный отчёт", attachment_id: "file", signed_attachment_id: null }] }]} />);
  expect(screen.getByText(/Исправлена сумма/)).toBeInTheDocument();
  expect(screen.getByText(/Требует исправления/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Разрешить|Утвердить/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Файл: Подписанный отчёт" }));
  await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: "Файл недоступен" })));
  expect(apiFetch).toHaveBeenCalledWith("/v1/publications/pub/files/file/url");
});
