import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancialRuleEditor } from "./financial-rule-editor";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
const row = { id: "rule", version: 7, active: true, definition: { name: "Месячный отчёт", form: "monthly", form_description: "Внешняя форма", building_ids: ["house"], prepared_by: "preparer", reviewer_id: "reviewer", publisher_id: "publisher", required_agreements: [{ code: "audit_basis", label: "Заключение", kind: "decision_basis", signed_required: true }], channels: ["Стенд"], report_signed_required: true } };
it("сохраняет исходный код основания и версию; конфликт оставляет введённую причину", async () => {
  const saved = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (path, request) => {
    if (request?.method) throw new Error("Версия изменилась. Обновите карточку");
    return path.includes("buildings") ? { items: [{ id: "house", code: "Дом 1" }] } : { items: ["preparer", "reviewer", "publisher"].map(id => ({ id, full_name: id, roles: ["administrator"] })) };
  });
  render(<FinancialRuleEditor rule={row} onCancel={vi.fn()} onSaved={saved} />);
  const region = screen.getByRole("region", { name: "Изменить финансовый регламент" });
  await screen.findByText("Дом 1");
  fireEvent.change(within(region).getByLabelText("Служебная причина"), { target: { value: "Уточнение формы" } });
  fireEvent.click(within(region).getByRole("button", { name: "Сохранить регламент" }));
  expect(await screen.findByText("Версия изменилась. Обновите карточку")).toBeInTheDocument();
  expect(within(region).getByLabelText("Служебная причина")).toHaveValue("Уточнение формы");
  const write = vi.mocked(apiFetch).mock.calls.find(([, request]) => request?.method);
  expect(write).toEqual(["/v1/financial-rules/rule", expect.objectContaining({ method: "PATCH", idempotencyKey: expect.any(String), body: expect.objectContaining({ expected_version: 7, reason: "Уточнение формы", required_agreements: row.definition.required_agreements, channels: ["Стенд"] }) })]);
  expect(saved).not.toHaveBeenCalled();
});
it("не разрешает сохранить регламент, пока справочники не загружены; повтор доступен", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Справочник недоступен"));
  render(<FinancialRuleEditor rule={null} onCancel={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByText("Справочник недоступен")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Сохранить регламент" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку справочников" }));
  await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.length).toBe(4));
  expect(vi.mocked(apiFetch).mock.calls.every(([, request]) => !request?.method)).toBe(true);
});
it("повтор после потери ответа сохраняет ключ того же намерения", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, request) => {
    if (request?.method) throw new TypeError("Ответ потерян");
    return path.includes("buildings") ? { items: [{ id: "house", code: "Дом 1" }] } : { items: ["preparer", "reviewer", "publisher"].map(id => ({ id, full_name: id, roles: ["administrator"] })) };
  });
  render(<FinancialRuleEditor rule={row} onCancel={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByText("Дом 1");
  fireEvent.change(screen.getByLabelText("Служебная причина"), { target: { value: "Уточнение формы" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить регламент" }));
  await screen.findByText("Ответ потерян");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить регламент" }));
  await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([, r]) => r?.method)).toHaveLength(2));
  const writes = vi.mocked(apiFetch).mock.calls.filter(([, r]) => r?.method);
  expect(writes[0]?.[1]?.idempotencyKey).toBe(writes[1]?.[1]?.idempotencyKey);
});
it("при 409 сохраняет ввод и требует сравнить актуальную версию перед повтором", async () => {
  let writes = 0;
  const saved = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (path, request) => {
    if (request?.method) { if (++writes === 1) throw Object.assign(new Error("Конфликт"), { status: 409 }); return {}; }
    if (path === "/v1/financial-rules") return { items: [{ ...row, version: 8, can_manage: true, definition: { ...row.definition, form_description: "Новая внешняя форма" } }] };
    return path.includes("buildings") ? { items: [{ id: "house", code: "Дом 1" }] } : { items: ["preparer", "reviewer", "publisher"].map(id => ({ id, full_name: id, roles: ["administrator"] })) };
  });
  render(<FinancialRuleEditor rule={row} onCancel={vi.fn()} onSaved={saved} />);
  await screen.findByText("Дом 1");
  fireEvent.change(screen.getByLabelText("Служебная причина"), { target: { value: "Наше уточнение" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить регламент" }));
  const reload = await screen.findByRole("button", { name: "Загрузить актуальную версию" });
  expect(screen.getByRole("button", { name: "Сохранить регламент" })).toBeDisabled();
  fireEvent.click(reload);
  await screen.findByText("Новая внешняя форма");
  expect(screen.getByLabelText("Служебная причина")).toHaveValue("Наше уточнение");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить регламент" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const calls = vi.mocked(apiFetch).mock.calls.filter(([, request]) => request?.method);
  expect(calls[1]?.[1]?.body).toMatchObject({ expected_version: 8, reason: "Наше уточнение", form_description: "Внешняя форма" });
  expect(calls[1]?.[1]?.idempotencyKey).not.toBe(calls[0]?.[1]?.idempotencyKey);
});
