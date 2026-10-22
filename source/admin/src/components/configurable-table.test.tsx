import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConfigurableTable } from "./configurable-table";
import { PageLayout } from "./page-layout";
const columns = [{ title: "Имя", dataIndex: "name" }, { title: "Телефон", dataIndex: "phone" }];
beforeEach(() => localStorage.clear());
afterEach(cleanup);
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
  expect(JSON.parse(localStorage.getItem("columns.people")!)).toEqual(["phone"]);
});
it("при смене вида реестра восстанавливается собственный набор колонок", () => {
  localStorage.setItem("columns.buildings", JSON.stringify(["phone"]));
  const { rerender } = render(<ConfigurableTable storageKey="columns.buildings" columns={columns} dataSource={[]} />);
  expect(screen.queryByRole("columnheader", { name: "Телефон" })).not.toBeInTheDocument();
  rerender(<ConfigurableTable storageKey="columns.people" columns={columns} dataSource={[]} />);
  expect(screen.getByRole("columnheader", { name: "Телефон" })).toBeInTheDocument();
});
it("при отсутствии фильтров настройка остаётся над таблицей, вложенная таблица имеет свой контрол", () => {
  render(<PageLayout title="Общие работы">
    <ConfigurableTable storageKey="columns.works" settingsPlacement="page" columns={columns} dataSource={[]} />
    <ConfigurableTable storageKey="columns.history" columns={columns} dataSource={[]} />
  </PageLayout>);
  expect(screen.getAllByRole("button", { name: "Колонки" })).toHaveLength(2);
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
});
