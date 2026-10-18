import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./app-layout";

const state = vi.hoisted(() => ({ roles: ["chairman", "tech_admin"] }));
vi.mock("@refinedev/core", () => ({ useLogout: () => ({ mutate: vi.fn() }) }));
vi.mock("../lib/identity", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/identity")>(),
  useCabinetIdentity: () => ({ roles: state.roles }),
}));
afterEach(cleanup);
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
    "Главная", "Обращения", "Задания", "Аварии", "Публикации", "Пользователи",
    "Помещения", "Уведомления", "Журнал действий", "Настройки",
  ]);
  fireEvent.click(screen.getByText("Настройки", { exact: true }));
  expect(within(screen.getAllByRole("menu")[1]!).getAllByRole("menuitem").map(item => item.textContent)).toEqual([
    "Настройки обращений", "Регламенты", "Шаблоны сообщений", "Эмуляция ролей (пилот)",
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
