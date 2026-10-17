import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IncidentsPage } from "./incidents";
import { PublicationsPage } from "./publications";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({ useCabinetIdentity: () => ({ roles: ["administrator"] }) }),
);
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element)
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("инцидент показывает незавершённое восстановление и историю", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/incidents"
      ? {
        items: [{
          id: "i",
          number: "АВ-1",
          title: "Вода",
          state: "recovery_check",
        }],
      }
      : path === "/v1/emergency-signals"
      ? { items: [] }
      : {
        id: "i",
        number: "АВ-1",
        title: "Вода",
        state: "recovery_check",
        forecast: "Уточняется",
        actions: ["complete"],
        scope: [{
          id: "s",
          zone: "Первый дом",
          service: "Вода",
          recovered_at: null,
        }],
        history: [{ at: "Сегодня", reason: "Второй стояк ещё проверяется" }],
      }
  );
  render(<IncidentsPage />);
  fireEvent.click(await screen.findByText("Открыть"));
  expect(await screen.findByText(/восстановление не подтверждено/))
    .toBeInTheDocument();
  expect(screen.getByText(/Второй стояк ещё проверяется/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Завершить"));
  expect(await screen.findByText("Проверенные зоны")).toBeInTheDocument();
  expect(screen.getByText(/Проверено: опасности нет/)).toBeInTheDocument();
}, 15000);
it("сбой списка виден пользователю; повтор не выполняет бизнес-действий", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Нет связи"));
  render(<IncidentsPage />);
  expect(await screen.findByText("Нет связи")).toBeInTheDocument();
  expect(
    vi.mocked(apiFetch).mock.calls.every(([, options]) =>
      !options?.method || options.method === "GET"
    ),
  ).toBe(true);
});
it(
  "отключение с истекшим планом остаётся без подтверждения восстановления",
  async () => {
    const row = {
      id: "p",
      title: "Промывка",
      kind: "outage",
      state: "published",
      body: "Работы продолжаются",
      planned_end: "2020-01-01",
      restored_at: null,
    };
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path === "/v1/publications" ? { items: [row] } : row
    );
    render(<PublicationsPage />);
    fireEvent.click(await screen.findByText("Открыть"));
    await waitFor(() =>
      expect(screen.getByText(/Фактическое восстановление: не подтверждено/))
        .toBeInTheDocument()
    );
    expect(screen.getByText("Подтвердить восстановление")).toBeInTheDocument();
  },
  15000,
);
