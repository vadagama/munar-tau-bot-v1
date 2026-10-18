import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegistryPage } from "./registry";
import { apiFetch } from "../lib/api";

vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("восстановление Telegram — самостоятельная форма в шторке с отменой", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({
    items: path === "/v1/registry/persons"
      ? [{ id: "person", full_name: "Иван Петров", phone_e164: "+77010000000" }]
      : [],
  }));
  render(<RegistryPage users="residents" />);
  fireEvent.click(await screen.findByRole("button", { name: "Восстановить Telegram" }));
  const field = await screen.findByLabelText("Как проверены личность и новый Telegram-аккаунт");
  const drawer = screen.getByRole("dialog");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  // Для отдельной формы важно и размещение: одна Modal здесь тоже была бы одним dialog.
  expect(field.closest(".ant-drawer-body")).not.toBeNull();
  expect(within(drawer).getByLabelText("Анкета с нового Telegram")).toBeInTheDocument();
  expect(within(drawer).getByText(/Прежняя привязка и все прежние сеансы/)).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Отмена" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(apiFetch).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
});


it("помещения не содержат вкладку людей", () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [] });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RegistryPage /></MemoryRouter>);
  expect(screen.queryByRole("tab", { name: "Лица" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Жители" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Импорт и экспорт" })).toBeNull();
});

it("жители не включают пользователей с действующими служебными назначениями", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [
    { id: "resident", full_name: "Житель", staff_roles: [] },
    { id: "staff", full_name: "Председатель-житель", staff_roles: ["chairman"] },
  ] });
  render(<RegistryPage users="residents" />);
  expect(await screen.findByText("Житель", { selector: "td" })).toBeInTheDocument();
  expect(screen.queryByText("Председатель-житель")).toBeNull();
});

it("сотрудники загружаются отдельно, включая сотрудников без помещения", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/staff")
    ? [{ id: "staff", full_name: "Сотрудник без квартиры", staff_roles: ["executor"] }] : [] }));
  render(<RegistryPage users="staff" />);
  expect(await screen.findByText("Сотрудник без квартиры")).toBeInTheDocument();
  expect(screen.getByText("Исполнитель")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Добавить запись" })).toBeNull();
});
