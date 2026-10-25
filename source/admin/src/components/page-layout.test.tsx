import { PageSearch } from "./page-controls";
import { ConfigurableTable } from "./configurable-table";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageLayout } from "./page-layout";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("располагает действия перед фильтрами и рабочей областью", () => {
  render(<PageLayout title="Обращения" extra="Доска" actions={<button>Создать</button>} filters={<input aria-label="Дом" />}><p>Рабочая область</p></PageLayout>);
  const title = screen.getByRole("heading", { name: "Обращения" });
  const actions = screen.getByRole("group", { name: "Действия страницы" });
  const filters = screen.getByRole("search");
  const content = screen.getByText("Рабочая область");
  for (const [a, b] of [[title, actions], [actions, filters], [filters, content]]) {
    expect(a!.compareDocumentPosition(b! ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 }
});
it("не создаёт пустые строки действий и фильтров", () => {
  render(<PageLayout title="Главная">Содержимое</PageLayout>);
  expect(screen.queryByRole("group")).toBeNull();
  expect(screen.queryByRole("search")).toBeNull();
});

it("на телефоне поиск доступен вне свёрнутых фильтров, сортировка находится внутри них", () => {
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({matches: query === "(max-width: 767px)", media: query, onchange:null,
    addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:()=>false}));

  render(<PageLayout title="Жители" actions={<button>Создать</button>}
    filters={<><PageSearch aria-label="Поиск жителей" /><input aria-label="Дом" /></>}>
    <ConfigurableTable storageKey="layout-mobile" rowKey="id" columns={[{title:"Имя",dataIndex:"name"}]}
      dataSource={[{id:"a",name:"Анна"}]} pagination={false} />
  </PageLayout>);
  const search = screen.getByRole("searchbox", { name: "Поиск жителей" });
  expect(search.closest("details")).toBeNull();
  expect(screen.getByText("Анна")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Сортировка списка" }).closest("details")).not.toHaveAttribute("open");
  const summary = screen.getByText("Фильтры и сортировка");
  expect(search.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(summary);
  expect(screen.getByRole("textbox", { name: "Дом" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Сортировка списка" }).closest("details")).toBe(summary.closest("details"));
  fireEvent.click(summary);
  expect(search).toBeVisible();
});
