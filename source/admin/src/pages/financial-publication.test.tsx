import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancialPublication } from "./financial-publication";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ identity: { id: "finance" } }) }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it("поздняя обязанность не заменяет выбранный регламент", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/financial-rules" ? { items: [{ id: "rule", name: "Регламент", version: 1, definition: { form_description: "Регламент выбран", channels: ["Бот"] } }] } : path === "/v1/financial-obligations" ? { items: [{ id: "duty", due_at: "2026-10-01T19:00:00Z", can_manage: false }] } : new Promise(resolve => { finish = resolve; }));
  render(<FinancialPublication manager={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть обязанность" }));
  fireEvent.click(screen.getByRole("tab", { name: "Регламенты отчётов" }));
  fireEvent.click(screen.getByRole("button", { name: "Открыть регламент" }));
  expect(await screen.findByText("Регламент выбран")).toBeInTheDocument();
  await act(async () => finish({ id: "duty", due_at: "2026-10-01T19:00:00Z", rule_snapshot: { definition: { form_description: "Поздняя обязанность", channels: ["Бот"] } } }));
  expect(screen.getByText("Регламент выбран")).toBeInTheDocument();
  expect(screen.queryByText("Поздняя обязанность")).not.toBeInTheDocument();
});
it("ошибка очереди видна, повтор не пишет данные", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Очередь недоступна"));
  render(<FinancialPublication manager={false} />);
  expect(await screen.findByText("Очередь недоступна")).toBeInTheDocument();
  fireEvent(window, new Event("cabinet:refresh-page"));
  expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it("читатель видит недостающие каналы и историю конкретных размещений", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/financial-rules" ? { items: [] } : path === "/v1/financial-obligations" ? { items: [{ id: "duty", version: 2, period_from: "2026-09-01", period_to: "2026-09-30", due_at: "2026-10-01T19:00:00Z", completed_at: null, can_manage: false }] } : {
    id: "duty", version: 2, due_at: "2026-10-01T19:00:00Z", can_manage: false, missing_channels: ["Стенд"], rule_snapshot: { definition: { form_description: "Внешний месячный отчёт", channels: ["Бот", "Стенд"] } }, placements: [{ id: "proof", financial_version_id: "version-one", channel: "Бот", placed_at: "2026-10-01T12:00:00Z", evidence: "Проверена карточка" }],
  });
  render(<FinancialPublication manager={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Открыть обязанность" }));
  expect(await screen.findByText("Осталось подтвердить: Стенд")).toBeInTheDocument();
  expect(screen.getByText("Проверена карточка")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Подтвердить размещение" })).not.toBeInTheDocument();
});
it("изменение существующего регламента определяется серверным разрешением", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/financial-rules" ? { items: [{ id: "rule", name: "Регламент", version: 1, can_manage: false, definition: { form_description: "Чужая область", channels: ["Бот"] } }] } : { items: [] });
  render(<FinancialPublication manager />);
  fireEvent.click(screen.getByRole("tab", { name: "Регламенты отчётов" }));
  fireEvent.click(await screen.findByRole("button", { name: "Открыть регламент" }));
  expect(await screen.findByText("Чужая область")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Изменить финансовый регламент" })).not.toBeInTheDocument();
});
