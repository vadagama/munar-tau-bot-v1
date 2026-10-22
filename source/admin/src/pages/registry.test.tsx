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
  fireEvent.click(screen.getByText("Добавить запись", {selector:"button > span"}));
  // Поля выбираются по связанной метке с selector=input: одноимённые
  // сортируемые заголовки таблицы не участвуют в поиске формы.
  const code = screen.getByLabelText("Обозначение", {selector:"input"});
  const drawer = code.closest('[role="dialog"]')!;
  fireEvent.change(code, { target: { value: "НОВЫЙ-1" } });
  fireEvent.mouseDown(screen.getByLabelText("Очередь строительства", {selector:"input"}));
  fireEvent.click(await screen.findByText("5-я очередь", { selector: ".ant-select-item-option-content" }));
  fireEvent.click(screen.getByText("Сохранить", {selector:"button > span"}));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/buildings", expect.objectContaining({
    method: "POST", body: expect.objectContaining({ construction_phase: 5 }),
  })));
  await waitFor(() => expect(drawer).not.toBeVisible());
  fireEvent.click(screen.getByText("Добавить запись", {selector:"button > span"}));
  fireEvent.change(screen.getByLabelText("Обозначение", {selector:"input"}), { target: { value: "НОВЫЙ-2" } });
  fireEvent.click(screen.getByText("Сохранить", {selector:"button > span"}));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/buildings", expect.objectContaining({
    method: "POST", body: expect.objectContaining({ code: "НОВЫЙ-2", construction_phase: null }),
  })));
});


it("очистка очереди существующего здания отправляет null, фон не сбрасывает черновик", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/buildings")
    ? [{ id: "b1", code: "ДОМ-1", construction_phase: 3 }] : [] }));
  render(<RegistryPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Здания" }));
  fireEvent.click(await screen.findByText("Изменить", {selector:"button > span"}));
  fireEvent.change(screen.getByLabelText("Обозначение", {selector:"input"}), { target: { value: "ДОМ-ИЗМЕНЁН" } });
  const phase = screen.getByLabelText("Очередь строительства", {selector:"input"});
  fireEvent.mouseDown(phase.closest(".ant-select")!.querySelector(".ant-select-clear")!);
  fireEvent(window, new Event("cabinet:refresh-page"));
  await waitFor(() => expect(screen.getByLabelText("Обозначение", {selector:"input"})).toHaveValue("ДОМ-ИЗМЕНЁН"));
  fireEvent.click(screen.getByText("Сохранить", {selector:"button > span"}));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/buildings/b1", expect.objectContaining({
    method: "PATCH", body: expect.objectContaining({ code: "ДОМ-ИЗМЕНЁН", construction_phase: null }),
  })));
});

it("удаление помещения: подтверждение с последствиями, DELETE и перечитывание", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/premises")
    ? [{ id: "p1", kind: "apartment", number: "1", status: "active" }] : [] }));
  render(<RegistryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
  const popover = await screen.findByRole("tooltip");
  expect(within(popover).getByText(/Удалятся связи, приглашения и анкеты помещения/)).toBeInTheDocument();
  expect(within(popover).getByText(/Обращения сохранятся без привязки/)).toBeInTheDocument();
  fireEvent.click(within(popover).getByRole("button", { name: "Удалить" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/registry/premises/p1", { method: "DELETE" }));
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("ошибка удаления помещения видна в общей ошибке страницы", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (options?.method === "DELETE") throw new Error("У здания есть аварийные сигналы — удаление запрещено");
    return { items: path.endsWith("/premises") ? [{ id: "p1", kind: "apartment", number: "1" }] : [] };
  });
  render(<RegistryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
  const popover = await screen.findByRole("tooltip");
  fireEvent.click(within(popover).getByRole("button", { name: "Удалить" }));
  expect(await screen.findByText("У здания есть аварийные сигналы — удаление запрещено")).toBeInTheDocument();
});

it("у зданий подтверждение предупреждает о каскаде и аварийных сигналах", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/buildings")
    ? [{ id: "b1", code: "ДОМ-1", construction_phase: 1 }] : [] }));
  render(<RegistryPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Здания" }));
  fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
  const popover = await screen.findByRole("tooltip");
  expect(within(popover).getByText(/Удалится дом вместе со всеми помещениями, связями, приглашениями и анкетами/)).toBeInTheDocument();
  expect(within(popover).getByText(/недоступно при активных аварийных сигналах/)).toBeInTheDocument();
});

it("жители и сотрудники без кнопки удаления", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/persons")
    ? [{ id: "n1", full_name: "Иван Петров", phone_e164: "+77010000000" }] : [] }));
  render(<RegistryPage users="residents" />);
  expect(await screen.findByText("Иван Петров")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
});

it("жители: адрес, основная анкета и помещения, автоматический поиск и фильтры", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/persons") ? [
    { id: "r1", full_name: "Анна Соколова", phone_e164: "+77011111111", registration_state: "approved", registered_at: "2026-10-20T20:00:00Z",
      linked_premises: [{ id: "p1", building_id: "b1", building_code: "107-1", building_name: "Улица Мира, 107/1", kind: "apartment", number: "4", role: "owner" }] },
    { id: "r2", full_name: "Борис Петров", registration_state: "pending_review", registered_at: "2026-10-19T08:00:00Z", linked_premises: [] },
    { id: "r3", full_name: "Вера Иванова", registration_state: null, registered_at: null, linked_premises: [] },
  ] : path.endsWith("/buildings") ? [{ id: "b1", code: "107-1", name: "Улица Мира, 107/1" }] : [] }));
  render(<RegistryPage users="residents" />);
  expect(await screen.findByText("Анна Соколова")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: /Адрес/ })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: /Статус регистрации/ })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: /Привязанные помещения/ })).toBeInTheDocument();
  expect(screen.getByText("Улица Мира, 107/1 (107-1)")).toBeInTheDocument();
  expect(screen.getByText("107-1 · Квартира 4 · Собственник")).toBeInTheDocument();
  expect(screen.getByText("Нет анкеты")).toBeInTheDocument();
  const search = screen.getByRole("searchbox", { name: "Поиск жителей" });
  for (const term of ["соколова", "77011111111", "Мира", "Квартира 4"]) {
    fireEvent.change(search, { target: { value: term } });
    expect(screen.getByText("Анна Соколова")).toBeInTheDocument();
    expect(screen.queryByText("Борис Петров")).not.toBeInTheDocument();
  }
  fireEvent.change(search, { target: { value: "" } });
  const choose = async (label: string, option: string) => {
    fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
    fireEvent.click(await screen.findByText(option, { selector: ".ant-select-item-option-content" }));
  };
  await choose("Наличие помещений", "Без помещений");
  expect(screen.queryByText("Анна Соколова")).not.toBeInTheDocument();
  expect(screen.getByText("Борис Петров")).toBeInTheDocument();
  await choose("Наличие помещений", "Есть помещения");
  await choose("Фильтр по зданию", "Улица Мира, 107/1");
  await choose("Статус регистрации", "Зарегистрирован");
  expect(screen.getByText("Анна Соколова")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Период регистрации с"), { target: { value: "2026-10-21" } });
  fireEvent.change(screen.getByLabelText("Период регистрации по"), { target: { value: "2026-10-21" } });
  expect(screen.getByText("Анна Соколова")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Период регистрации с"), { target: { value: "2026-10-22" } });
  expect(screen.queryByText("Анна Соколова")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Применить" })).not.toBeInTheDocument();
});
