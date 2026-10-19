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


it("фильтрует здания по очереди, отсутствию очереди и возвращает все", async () => {
  const buildings = [
    { id: "b1", code: "ДОМ-1", construction_phase: 1 },
    { id: "b2", code: "ДОМ-2", construction_phase: 2 },
    { id: "b3", code: "ДОМ-3", construction_phase: null },
  ];
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/buildings") ? buildings : [] }));
  render(<RegistryPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Здания" }));
  expect(await screen.findByText("ДОМ-3")).toBeInTheDocument();
  const select = screen.getByRole("combobox", { name: "Фильтр по очереди строительства" });
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByText("2-я очередь", { selector: ".ant-select-item-option-content" }));
  expect(screen.getByText("ДОМ-2")).toBeInTheDocument();
  expect(screen.queryByText("ДОМ-1")).toBeNull();
  expect(screen.queryByText("ДОМ-3")).toBeNull();
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByText("Не указана", { selector: ".ant-select-item-option-content" }));
  expect(screen.getByText("ДОМ-3")).toBeInTheDocument();
  expect(screen.queryByText("ДОМ-2")).toBeNull();
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByText("Все очереди", { selector: ".ant-select-item-option-content" }));
  expect(screen.getByText("ДОМ-1")).toBeInTheDocument();
  expect(screen.getByText("ДОМ-2")).toBeInTheDocument();
});

it("сохраняет выбранную очередь здания и явное отсутствие очереди", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [] });
  render(<RegistryPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Здания" }));
  fireEvent.click(screen.getByRole("button", { name: "Добавить запись" }));
  fireEvent.change(screen.getByLabelText("Обозначение"), { target: { value: "НОВЫЙ-1" } });
  fireEvent.mouseDown(screen.getByLabelText("Очередь строительства"));
  fireEvent.click(await screen.findByText("5-я очередь", { selector: ".ant-select-item-option-content" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/buildings", expect.objectContaining({
    method: "POST", body: expect.objectContaining({ construction_phase: 5 }),
  })));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Добавить запись" }));
  fireEvent.change(screen.getByLabelText("Обозначение"), { target: { value: "НОВЫЙ-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/buildings", expect.objectContaining({
    method: "POST", body: expect.objectContaining({ code: "НОВЫЙ-2", construction_phase: null }),
  })));
});


it("очистка очереди существующего здания отправляет null, фон не сбрасывает черновик", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/buildings")
    ? [{ id: "b1", code: "ДОМ-1", construction_phase: 3 }] : [] }));
  render(<RegistryPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Здания" }));
  fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
  fireEvent.change(screen.getByLabelText("Обозначение"), { target: { value: "ДОМ-ИЗМЕНЁН" } });
  const phase = screen.getByLabelText("Очередь строительства");
  fireEvent.mouseDown(phase.closest(".ant-select")!.querySelector(".ant-select-clear")!);
  fireEvent(window, new Event("cabinet:refresh-page"));
  await waitFor(() => expect(screen.getByLabelText("Обозначение")).toHaveValue("ДОМ-ИЗМЕНЁН"));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/buildings/b1", expect.objectContaining({
    method: "PATCH", body: expect.objectContaining({ code: "ДОМ-ИЗМЕНЁН", construction_phase: null }),
  })));
});
