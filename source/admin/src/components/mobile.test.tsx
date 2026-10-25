import { Button } from "antd";
import { CardDrawer } from "../pages/card-drawer";
import { ProcessActions } from "./process-card";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ViewToggle, useBoardView } from "../pages/board";
import { ConfigurableTable } from "./configurable-table";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
function mobile() {
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 767px)", media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false }));
}
it("на телефоне сохранённая доска становится списком без потери настольного выбора", () => {
  mobile(); localStorage.setItem("view.mobile-test", "board");
  function Example() { const [kind, setKind] = useBoardView("view.mobile-test"); return <><p>{kind}</p><ViewToggle kind={kind} onChange={setKind} /></>; }
  render(<Example />);
  expect(screen.getByText("table")).toBeInTheDocument();
  expect(screen.queryByText("Доска")).not.toBeInTheDocument();
  expect(localStorage.getItem("view.mobile-test")).toBe("board");
});
it("на телефоне показывает данные записи и действия без настройки колонок", () => {
  mobile();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  render(<ConfigurableTable storageKey="columns.mobile-test" rowKey="id" columns={[{title:"Имя",dataIndex:"name"}]}
    dataSource={[{id:"1",name:"Иван"}]} />);
  expect(screen.getByText("Иван")).toBeInTheDocument();
  expect(screen.queryByRole("button", {name:"Колонки"})).not.toBeInTheDocument();
});

it("мобильная сортировка применяется ко всему списку до пагинации", () => {
  mobile();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  render(<ConfigurableTable storageKey="columns.mobile-sort" rowKey="id" columns={[{title:"Номер",dataIndex:"name"}]}
    pagination={{pageSize:1}} dataSource={[{id:"a",name:"ЗД-10"},{id:"b",name:"ЗД-2"}]} />);
  fireEvent.click(screen.getByText("Фильтры и сортировка"));
  fireEvent.mouseDown(screen.getByRole("combobox",{name:"Сортировка списка"}));
  fireEvent.click(screen.getByText("Номер ↑"));
  expect(screen.getByText("ЗД-2")).toBeInTheDocument();
  expect(screen.queryByText("ЗД-10")).not.toBeInTheDocument();
});

it("основное действие карточки доступно в нижней панели без дублирования", () => {
  mobile();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  const act = vi.fn();
  render(<CardDrawer open title="ЗД-1" onClose={vi.fn()}>
    <ProcessActions primary="accept"><Button key="accept" onClick={act}>Принять</Button><Button key="cancel">Отменить</Button></ProcessActions>
  </CardDrawer>);
  const action = screen.getByRole("button",{name:"Принять"});
  expect(action.closest(".ant-drawer-footer")).not.toBeNull();
  fireEvent.click(action);
  expect(act).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button",{name:"Развернуть карточку"})).not.toBeInTheDocument();
});

it("сортировка мобильного реестра возвращает первую управляемую страницу", () => {
  mobile();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  const onPage = vi.fn();
  render(<ConfigurableTable storageKey="columns.mobile-controlled" rowKey="id" columns={[{title:"Номер",dataIndex:"name"}]}
    pagination={{current:2,pageSize:1,onChange:onPage}} dataSource={[{id:"a",name:"ЗД-10"},{id:"b",name:"ЗД-2"}]} />);
  fireEvent.click(screen.getByText("Фильтры и сортировка"));
  fireEvent.mouseDown(screen.getByRole("combobox",{name:"Сортировка списка"}));
  fireEvent.click(screen.getByText("Номер ↑"));
  expect(onPage).toHaveBeenCalledWith(1,1);
});
