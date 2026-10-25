import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentObligations } from "./document-obligations";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it("сохраняет видимость обязанности после приёмки, не выдаёт её за завершённую", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: "o", source_number: "ОБ-1", kind: "act", phase: "after_acceptance", completed_at: null, due_at: "2026-10-23T12:00:00Z", can_manage: true }] });
  render(<DocumentObligations manager />);
  expect(await screen.findByText("ОБ-1")).toBeInTheDocument();
  expect(screen.getByText("После приёмки")).toBeInTheDocument();
  expect(screen.getByText("Не завершено")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Передать обязанность" })).toBeInTheDocument();
});
it("позволяет выбрать документ за пределами первой страницы", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (path === "/v1/documents/obligations") return { items: [{ id: "o", source_number: "ОБ-1", kind: "act", phase: "after_acceptance", due_at: "2026-10-23T12:00:00Z", can_manage: true }] } as never;
    if (String(path).includes("offset=50")) return { items: [{ id: "old", title: "Старый акт" }], total: 51 } as never;
    return { items: Array.from({ length: 50 }, (_, i) => ({ id: String(i), title: `Документ ${i}` })), total: 51 } as never;
 });
  render(<DocumentObligations manager />);
  fireEvent.click(await screen.findByRole("button", { name: "Указать проверенную версию" }));
  fireEvent.click(await screen.findByRole("button", { name: "Загрузить ещё документы" }));
  expect(apiFetch).toHaveBeenCalledWith("/v1/documents?offset=50&limit=50");
});
