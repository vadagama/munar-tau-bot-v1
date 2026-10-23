import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { AppLayout } from "./app-layout";

const state = vi.hoisted(() => ({ roles: ["chairman", "tech_admin"], emulating: false }));
vi.mock("@refinedev/core", () => ({ useLogout: () => ({ mutate: vi.fn() }) }));
vi.mock("../lib/identity", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/identity")>(),
  useCabinetIdentity: () => ({ roles: state.roles, identity: state.emulating ? {
    fullName: "Тестовый житель", me: {
      profile: { id: "resident" }, person: { full_name: "Тестовый житель" },
      emulation: { session_id: "session", real_person_full_name: "Техадминистратор" },
    },
  } : undefined }),
}));
vi.mock("../lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ persons: [] }) }));
afterEach(() => { cleanup(); state.emulating = false; vi.clearAllMocks(); });
function show(path = "/") {
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Routes><Route element={<AppLayout />}>
      <Route path="*" element={<div>Страница</div>} />
    </Route></Routes>
  </MemoryRouter>);
}
it("порядок главного меню и вложенные настройки соответствуют структуре кабинета", () => {
  state.roles = ["chairman", "tech_admin"];
  show();
  const menu = screen.getByRole("menu");
  expect(Array.from(menu.children).map(item => item.textContent)).toEqual([
    "Главная", "Обращения", "Задания", "Аварии", "Публикации", "Документы", "Пользователи",
    "Объекты эксплуатации", "Уведомления", "Журнал действий", "Настройки",
  ]);
  fireEvent.click(screen.getByText("Настройки", { exact: true }));
  expect(within(screen.getAllByRole("menu")[1]!).getAllByRole("menuitem").map(item => item.textContent)).toEqual([
    "Импорт и экспорт", "Настройки обращений", "Регламенты", "Шаблоны сообщений", "Эмуляция ролей (пилот)",
  ]);
});
it("прямая ссылка раскрывает пользователей и выделяет сотрудников", () => {
  state.roles = ["chairman"];
  show("/users/staff");
  expect(screen.getByRole("menuitem", { name: "Жители" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Сотрудники" })).toHaveClass("ant-menu-item-selected");
});
it("житель видит личные уведомления без служебных разделов", () => {
  state.roles = [];
  show("/notifications/preferences");
  expect(screen.queryByText("Пользователи")).toBeNull();
  expect(screen.queryByText("Настройки", { exact: true })).toBeNull();
  expect(screen.queryByText("Ошибки доставки")).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Мои настройки" })).toBeVisible();
});

it("импорт и экспорт раскрывает настройки и выделяет собственный пункт", () => {
  state.roles = ["administrator"];
  show("/registry-import");
  expect(screen.getByRole("menuitem", { name: "Импорт и экспорт" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Импорт и экспорт" })).toHaveClass("ant-menu-item-selected");
  expect(screen.queryByRole("menuitem", { name: "Помещения" })).toBeNull();
});

it("вне эмуляции не показывает выбор роли и не загружает персон", () => {
  show();
  expect(screen.queryByRole("combobox", { name: "Роль эмуляции" })).toBeNull();
  expect(apiFetch).not.toHaveBeenCalled();
});
it("только в эмуляции показывает выбор роли слева от выхода", async () => {
  state.emulating = true;
  state.roles = [];
  show();
  const select = screen.getByRole("combobox", { name: "Роль эмуляции" });
  expect(select.compareDocumentPosition(screen.getByRole("button", { name: "Выйти" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/emulation/persons"));
});

it.each([
  ["/tasks", "Все задания"], ["/common-works", "Общие работы"], ["/job-templates", "Шаблоны заданий"],
])("%s раскрывает группу Задания и выделяет свой пункт", (path, label) => {
  state.roles = ["chairman"];
  show(path);
  expect(screen.getByRole("menuitem", { name: label })).toHaveClass("ant-menu-item-selected");
  expect(screen.getByRole("menuitem", { name: "Все задания" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Общие работы" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Шаблоны заданий" })).toBeVisible();
});
it("исполнитель видит в группе только Все задания", () => {
  state.roles = ["executor"];
  show("/tasks");
  expect(screen.getByRole("menuitem", { name: "Все задания" })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Общие работы" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Шаблоны заданий" })).not.toBeInTheDocument();
});

it.each([
 ["/registry/buildings", "Здания"], ["/registry/premises", "Помещения"],
 ["/registry/connections", "Привязки помещений"], ["/registry/phases", "Очереди"],
])("%s раскрывает Объекты эксплуатации и выделяет подраздел", (path, label) => {
 state.roles = ["administrator"];
 show(path);
 expect(screen.getByText("Объекты эксплуатации")).toBeVisible();
 expect(screen.getByRole("menuitem", {name: label})).toHaveClass("ant-menu-item-selected");
 for (const name of ["Здания", "Помещения", "Привязки помещений", "Очереди"]) {
   expect(screen.getByRole("menuitem", {name})).toBeVisible();
 }
});
