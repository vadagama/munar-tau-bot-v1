import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublicationsPage } from "./publications";
import { apiFetch } from "../lib/api";
import { PAGE_REFRESH_EVENT } from "../lib/use-page-refresh";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ roles: ["chairman"], identity: { id: "person" } }) }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
const card = { id: "pub", title: "Сентябрь", body: "Отчёт", kind: "financial_report", state: "pending_approval", version: 3, financial_versions: [], can_manage: true, can_approve: true };
it("собирает финансовый выпуск из обязанности и выбранных проверенных версий", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (options?.method) return { id: "pub" };
    if (path === "/v1/publications") return { items: [] };
    if (path === "/v1/documents/version-options") return { items: [{ id: "report", document_id: "doc-report", title: "Основной отчёт", kind: "financial_report", audience: "owner", version: 1, signed: true }, { id: "basis", document_id: "doc-basis", title: "Решение совета", kind: "decision_basis", audience: "finance", version: 1, signed: true }], has_more: false };
    if (path === "/v1/financial-obligations") return { items: [{ id: "duty", publication_id: null, period_from: "2026-09-01", period_to: "2026-09-30" }], has_more: false };
    if (path === "/v1/financial-obligations/duty") return { id: "duty", period_from: "2026-09-01", period_to: "2026-09-30", building_ids: ["house"], rule_snapshot: { definition: { form_description: "Форма за сентябрь", report_signed_required: true, required_agreements: [{ code: "council", label: "Решение совета", kind: "decision_basis", signed_required: true }] } } };
    if (path === "/v1/registry/buildings") return { items: [{ id: "house", code: "Дом 1" }] };
    if (path === "/v1/common-works") return { items: [] };
    if (path === "/v1/incidents/context") return { persons: [] };
    return card;
  });
  render(<PublicationsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Создать публикацию" }));
  const editor = within(await screen.findByRole("region", { name: "Новая публикация" }));
  fireEvent.mouseDown(editor.getByLabelText("Вид"));
  fireEvent.click(await screen.findByText("Финансовый отчёт"));
  fireEvent.change(editor.getByLabelText("Название"), { target: { value: "Сентябрь" } });
  fireEvent.change(editor.getByLabelText("Текст для жителей"), { target: { value: "Отчёт за сентябрь" } });
  fireEvent.change(editor.getByLabelText("Служебная причина"), { target: { value: "Плановый отчёт" } });
  fireEvent.mouseDown(editor.getByLabelText("Обязанность по отчёту"));
  fireEvent.click(await screen.findByText("2026-09-01 — 2026-09-30"));
  fireEvent.mouseDown(await screen.findByLabelText("Проверенная версия финансового отчёта"));
  fireEvent.click(await screen.findByText("Основной отчёт · версия 1 · подписан"));
  fireEvent.mouseDown(screen.getByLabelText("Основание: Решение совета"));
  fireEvent.click(await screen.findByText("Решение совета · версия 1 · подписан"));
  fireEvent.click(within(screen.getByRole("region", { name: "Новая публикация" })).getByRole("button", { name: "Создать публикацию" }));
  await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/publications", expect.objectContaining({ method: "POST", idempotencyKey: expect.any(String), body: expect.objectContaining({ kind: "financial_report", obligation_id: "duty", period_from: "2026-09-01", period_to: "2026-09-30", building_ids: ["house"], report_version_id: "report", basis_versions: [{ code: "council", document_version_id: "basis" }], disclosed_version_ids: ["report"], requires_document: true, reason: "Плановый отчёт" }) })));
}, 15000);
it("фоновое обновление списка не отменяет открываемую карточку", async () => {
  let finish!: (value: typeof card) => void;
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/publications" ? { items: [card] } : new Promise(resolve => { finish = resolve; }));
  render(<PublicationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));
  await act(async () => window.dispatchEvent(new Event(PAGE_REFRESH_EVENT)));
  await vi.waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/publications")).toHaveLength(2));
  await act(async () => finish(card));
  expect(await screen.findByText("Комплект ещё не подготовлен.")).toBeInTheDocument();
});
it("серверные разрешения финансовой карточки ограничивают служебные действия", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/publications" ? { items: [card] } : { ...card, can_manage: false, can_approve: false });
  render(<PublicationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));
  expect(await screen.findByText("Комплект ещё не подготовлен.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Разрешить/ })).not.toBeInTheDocument();
});
it("конфликт разрешения сохраняет служебную причину и основание внешнего согласования", async () => {
  let version = 3;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (options?.method) { version = 4; throw Object.assign(new Error("Конфликт"), { status: 409 }); }
    return path === "/v1/publications" ? { items: [card] } : { ...card, version };
  });
  render(<PublicationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));
  fireEvent.click(await screen.findByRole("button", { name: "Разрешить финансовый выпуск" }));
  fireEvent.change(screen.getByLabelText("Основание внешних согласований"), { target: { value: "Решение совета проверено" } });
  fireEvent.change(screen.getByLabelText("Служебная причина"), { target: { value: "Выпуск за сентябрь" } });
  fireEvent.click(within(screen.getByRole("region", { name: "Разрешить финансовый выпуск" })).getByRole("button", { name: "Разрешить финансовый выпуск" }));
  expect(await screen.findByText(/Карточка изменена другим пользователем/)).toBeInTheDocument();
  expect(screen.getByLabelText("Служебная причина")).toHaveValue("Выпуск за сентябрь");
  expect(screen.getByLabelText("Основание внешних согласований")).toHaveValue("Решение совета проверено");
}, 15000);
