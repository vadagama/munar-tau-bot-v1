import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigurableTable } from "./configurable-table";
import { PageLayout } from "./page-layout";
const columns = [{ title: "Имя", dataIndex: "name" }, { title: "Телефон", dataIndex: "phone" }];
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("шестерёнка находится справа в строке фильтров, скрывает колонку и сохраняет выбор", async () => {
  render(<PageLayout title="Жители" filters={<input aria-label="Поиск" />}>
    <ConfigurableTable storageKey="columns.people" settingsPlacement="page" columns={columns} dataSource={[]} />
  </PageLayout>);
  const filters = screen.getByRole("search");
  const settings = within(filters).getByRole("button", { name: "Колонки" });
  expect(settings).toHaveAttribute("title", "Настройка колонок");
  expect(settings.querySelector('[aria-label="setting"]')).not.toBeNull();
  fireEvent.click(settings);
  const choices = await screen.findByRole("group", { name: "Видимые колонки" });
  expect(within(choices).getByRole("checkbox", { name: "Имя" })).toBeDisabled();
  fireEvent.click(within(choices).getByRole("checkbox", { name: "Телефон" }));
  expect(screen.queryByRole("columnheader", { name: "Телефон" })).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("columns.people")!)).toEqual({ v: 2, hidden: ["phone"] });
});
it("при смене вида реестра восстанавливается собственный набор колонок", () => {
  localStorage.setItem("columns.buildings", JSON.stringify(["phone"]));
  const { rerender } = render(<ConfigurableTable storageKey="columns.buildings" columns={columns} dataSource={[]} />);
  expect(screen.queryByRole("columnheader", { name: "Телефон" })).not.toBeInTheDocument();
  rerender(<ConfigurableTable storageKey="columns.people" columns={columns} dataSource={[]} />);
  expect(screen.getByRole("columnheader", { name: "Телефон" })).toBeInTheDocument();
});
it("колонка со defaultHidden скрыта у нового пользователя и у настроенного старого", () => {
  const withHidden = [...columns, { title: "Отзыв", dataIndex: "withdrawn_at", defaultHidden: true }];
  // Новый пользователь: скрыта по умолчанию.
  render(<ConfigurableTable storageKey="columns.fresh" columns={withHidden} dataSource={[]} />);
  expect(screen.queryByRole("columnheader", { name: "Отзыв" })).not.toBeInTheDocument();
  cleanup();
  // Старое сохранение (формат до появления defaultHidden) — колонка тоже скрыта.
  localStorage.setItem("columns.old", JSON.stringify(["phone"]));
  render(<ConfigurableTable storageKey="columns.old" columns={withHidden} dataSource={[]} />);
  expect(screen.queryByRole("columnheader", { name: "Отзыв" })).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Телефон" })).not.toBeInTheDocument();
  cleanup();
  // Явное включение сохраняется: повторное открытие показывает колонку.
  render(<ConfigurableTable storageKey="columns.old" columns={withHidden} dataSource={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Видимые колонки" })).getByRole("checkbox", { name: "Отзыв" }));
  expect(screen.getByRole("columnheader", { name: "Отзыв" })).toBeInTheDocument();
  cleanup();
  render(<ConfigurableTable storageKey="columns.old" columns={withHidden} dataSource={[]} />);
  expect(screen.getByRole("columnheader", { name: "Отзыв" })).toBeInTheDocument();
});
it("при отсутствии фильтров настройка остаётся над таблицей, вложенная таблица имеет свой контрол", () => {
  render(<PageLayout title="Общие работы">
    <ConfigurableTable storageKey="columns.works" settingsPlacement="page" columns={columns} dataSource={[]} />
    <ConfigurableTable storageKey="columns.history" columns={columns} dataSource={[]} />
  </PageLayout>);
  expect(screen.getAllByRole("button", { name: "Колонки" })).toHaveLength(2);
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
});

it("заголовок сортирует весь загруженный список до пагинации в обоих направлениях и сбрасывает порядок", () => {
  render(<ConfigurableTable storageKey="columns.sort-test" rowKey="id"
    columns={[{title:"Номер",dataIndex:"number"},{title:"Работа",dataIndex:"title"}]}
    dataSource={[{id:"a",number:"ЗД-10",title:"Десять"},{id:"b",number:"ЗД-2",title:"Два"}]}
    pagination={{pageSize:1}} />);
  const header = screen.getByRole("columnheader",{name:"Номер"});
  fireEvent.click(header);
  expect(screen.getByRole("cell",{name:"ЗД-2"})).toBeInTheDocument();
  expect(header).toHaveAttribute("aria-sort","ascending");
  fireEvent.click(header);
  expect(screen.getByRole("cell",{name:"ЗД-10"})).toBeInTheDocument();
  expect(header).toHaveAttribute("aria-sort","descending");
  fireEvent.click(header);
  expect(header).not.toHaveAttribute("aria-sort");
  expect(screen.getByRole("cell",{name:"ЗД-10"})).toBeInTheDocument();
});
