import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentsPage } from "./documents";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ roles: ["administrator"], identity: { id: "p" } }) }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it("показывает сбой и позволяет повторить чтение без записи", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (path === "/v1/documents") throw new Error("Список недоступен");
    return { items: [] };
  });
  render(<DocumentsPage />);
  expect(await screen.findByText("Список недоступен")).toBeInTheDocument();
  fireEvent(window, new Event("cabinet:refresh-page"));
  expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});
it("показывает отсутствие документов", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [], total: 0 });
  render(<DocumentsPage />);
  expect(await screen.findByText("Документов нет")).toBeInTheDocument();
});
it("читатель видит версии без служебных действий", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/documents/obligations" ? { items: [] } : path === "/v1/documents" ? { items: [{ id: "d", title: "Инструкция", kind: "instruction", version: 3 }] } : {
    id: "d", title: "Инструкция", document_date: "2026-10-23", audience: "resident", version: 3,
    can_prepare: false, can_review: false, can_manage: false,
    versions: [{ id: "v", version: 1, state: "approved", attachment_id: "f" }], history: [],
  });
  render(<DocumentsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("Проверен")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Вернуть" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Новая версия" })).not.toBeInTheDocument();
});
it("конфликт версии сохраняет причину возврата в одной шторке", async () => {
  let version = 3;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (options?.method === "POST") { version = 4; throw Object.assign(new Error("Конфликт"), { status: 409 }); }
    if (path === "/v1/documents/obligations") return { items: [] };
    if (path === "/v1/documents") return { items: [{ id: "d", title: "Акт", kind: "act", version }] };
    return { id: "d", title: "Акт", audience: "staff", version, can_prepare: false, can_review: true, can_manage: true,
      versions: [{ id: "v", version: 1, state: "on_review", attachment_id: "file" }], history: [] };
  });
  render(<DocumentsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));
  fireEvent.click(await screen.findByRole("button", { name: "Вернуть" }));
  fireEvent.change(screen.getByLabelText("Причина / основание"), { target: { value: "Не указан объём работ" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(await screen.findByText(/Карточка изменена другим пользователем/)).toBeInTheDocument();
  expect(screen.getByLabelText("Причина / основание")).toHaveValue("Не указан объём работ");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
}, 15000);
