import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/api";
import { usePageRefresh } from "../lib/use-page-refresh";
const { refreshIdentity } = vi.hoisted(() => ({ refreshIdentity: vi.fn().mockResolvedValue({}) }));
import { EmulationPage } from "./emulation";
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ identity: { me: { emulation: null } }, refreshIdentity }) }));
vi.mock("../lib/use-page-refresh", () => ({ usePageRefresh: vi.fn() }));
vi.mock("../lib/api", () => ({
  ApiClientError: class extends Error { constructor(_code: string, message: string, _status: number) { super(message); } },
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

it("снятие роли: крестик на теге открывает модалку с обязательной причиной и отправляет revoke", async () => {
  render(<EmulationPage />);
  await screen.findByText("Тестовый сотрудник");
  // Закрываемый тег роли сотрудника.
  fireEvent.click(document.querySelector(".ant-tag-close-icon")!);
  const dialog = await screen.findByRole("dialog", { name: "Снять роль" });
  expect(within(dialog).getByText(/Снять роль «Исполнитель» с персоны «Тестовый сотрудник»/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Снять роль" }));
  expect(await within(dialog).findByText("Укажите причину снятия роли")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
  fireEvent.change(within(dialog).getByLabelText("Причина"), { target: { value: "Роль больше не нужна" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Снять роль" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/emulation/assignments/role/revoke", {
    method: "POST",
    body: { reason: "Роль больше не нужна" },
  }));
  await waitFor(() => expect(refreshIdentity).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Снять роль" })).toBeNull());
  expect(await screen.findByText(/Роль «Исполнитель» снята с персоны «Тестовый сотрудник»/)).toBeInTheDocument();
});

it("ошибка снятия роли видна, модалка остаётся открытой", async () => {
  const { ApiClientError } = await import("../lib/api");
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (String(options?.method ?? "GET") === "POST") throw new ApiClientError("VALIDATION_FAILED", "Роли удаляются только у тестовых персон", 400);
    return { persons: [
      { person: { id: "staff", full_name: "Тестовый сотрудник" }, profile: { id: "staff-profile" }, assignments: [{ id: "role", role: "executor" }] },
    ] };
  });
  render(<EmulationPage />);
  await screen.findByText("Тестовый сотрудник");
  fireEvent.click(document.querySelector(".ant-tag-close-icon")!);
  const dialog = await screen.findByRole("dialog", { name: "Снять роль" });
  fireEvent.change(within(dialog).getByLabelText("Причина"), { target: { value: "Причина" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Снять роль" }));
  expect(await screen.findByText("Роли удаляются только у тестовых персон")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Снять роль" })).toBeInTheDocument();
});
