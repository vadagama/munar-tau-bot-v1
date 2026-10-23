import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancialDutyEditor } from "./financial-duty-editor";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it("передача отправляет только ответственных, исходную версию и причину; ошибка сохраняет ввод", async () => {
  vi.mocked(apiFetch).mockImplementation(async (_, request) => { if (request?.method) throw new Error("Нет полномочий"); return { items: ["p", "r", "u"].map(id => ({ id, full_name: id, roles: ["administrator"] })) }; });
  const saved = vi.fn();
  render(<FinancialDutyEditor duty={{ id: "duty", version: 4, prepared_by: "p", reviewer_id: "r", publisher_id: "u", due_at: "2026-10-01T19:00:00Z" }} onCancel={vi.fn()} onSaved={saved} />);
  await screen.findByText("p");
  fireEvent.change(screen.getByLabelText("Служебная причина"), { target: { value: "Передача обязанностей" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить ответственных" }));
  await screen.findByText("Нет полномочий");
  expect(screen.getByLabelText("Служебная причина")).toHaveValue("Передача обязанностей");
  const call = vi.mocked(apiFetch).mock.calls.find(([, request]) => request?.method);
  expect(call).toEqual(["/v1/financial-obligations/duty/reassign", expect.objectContaining({ method: "POST", body: { prepared_by: "p", reviewer_id: "r", publisher_id: "u", reason: "Передача обязанностей", expected_version: 4 }, idempotencyKey: expect.any(String) })]);
  expect(saved).not.toHaveBeenCalled();
});
it("создание без настроенных регламентов не отправляет запись", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [] });
  render(<FinancialDutyEditor duty={null} onCancel={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByText("Нет действующих финансовых регламентов с правом управления");
  fireEvent.click(screen.getByRole("button", { name: "Создать обязанность" }));
  await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.every(([, request]) => !request?.method)).toBe(true));
  expect(screen.queryByLabelText("Срок размещения")).not.toBeInTheDocument();
});
