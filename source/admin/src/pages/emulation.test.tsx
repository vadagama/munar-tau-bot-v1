import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/api";
import { usePageRefresh } from "../lib/use-page-refresh";
const { refreshIdentity } = vi.hoisted(() => ({ refreshIdentity: vi.fn().mockResolvedValue({}) }));
import { EmulationPage } from "./emulation";
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ identity: { me: { emulation: null } }, refreshIdentity }) }));
vi.mock("../lib/use-page-refresh", () => ({ usePageRefresh: vi.fn() }));
vi.mock("../lib/api", () => ({
  ApiClientError: class extends Error {},
  apiFetch: vi.fn(),
}));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.mocked(apiFetch).mockResolvedValue({ persons: [
    { person: { id: "resident", full_name: "Тестовый житель" }, profile: { id: "resident-profile" }, assignments: [] },
    { person: { id: "staff", full_name: "Тестовый сотрудник" }, profile: { id: "staff-profile" }, assignments: [{ id: "role", role: "executor" }] },
  ] }); refreshIdentity.mockClear(); vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("показывает жителя без служебных назначений и сотрудника с ролью", async () => {
  render(<EmulationPage />);
  expect(await screen.findByText("Тестовый житель")).toBeInTheDocument();
  expect(screen.getByText("Тестовый сотрудник")).toBeInTheDocument();
});

it("обновляет персону без перехода с экрана эмуляции", async () => {
  render(<EmulationPage />);
  await screen.findByText("Тестовый житель");
  fireEvent.click(screen.getAllByRole("button", { name: "Войти под персоной" })[0]!);
  await waitFor(() => expect(refreshIdentity).toHaveBeenCalledOnce());
  expect(screen.getByText("Тестовый житель")).toBeInTheDocument();
});

it("не убирает таблицу при фоновом чтении списка персон", async () => {
  render(<EmulationPage />);
  const resident = await screen.findByText("Тестовый житель");
  let finish!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = vi.mocked(usePageRefresh).mock.calls.at(-1)![0];
  let pending: unknown;
  act(() => { pending = refresh(); });
  expect(screen.getByText("Тестовый житель")).toBe(resident);
  await act(async () => { finish({ persons: [] }); await pending; });
});
