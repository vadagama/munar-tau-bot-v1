import { createElement } from "react";
import { expect, it, vi } from "vitest";
import type { ColumnType, SortOrder } from "antd/es/table/interface";
import { withColumnSorting } from "./table-sorting";

type Row = { value: unknown; label?: string };
function ordered(column: ColumnType<Row>, values: Row[], order: SortOrder = "ascend") {
  const sorter = withColumnSorting<Row>(column).sorter;
  if (typeof sorter !== "function") throw new Error("Expected a local comparator");
  return [...values].sort((a, b) => sorter(a, b, order) * (order === "descend" ? -1 : 1));
}
it("числа и естественные номера сортируются по значению", () => {
  expect(ordered({ dataIndex: "value" }, [{value:10},{value:2}]).map(row => row.value)).toEqual([2,10]);
  expect(ordered({ dataIndex: "value" }, [{value:"ЗД-10"},{value:"ЗД-2"}]).map(row => row.value)).toEqual(["ЗД-2","ЗД-10"]);
});
it("даты сравниваются хронологически с учётом часового пояса, а не по подписи", () => {
  const rows = [{value:"2026-10-22T00:30:00+05:00"},{value:"2026-10-21T21:00:00Z"}];
  expect(ordered({ dataIndex: "value", render: () => "одинаковая подпись" }, rows)).toEqual(rows);
});
it("пустые значения идут последними при обоих направлениях", () => {
  const rows = [{value:null},{value:"Я"},{value:"А"}];
  expect(ordered({ dataIndex:"value" }, rows).map(row=>row.value)).toEqual(["А","Я",null]);
  expect(ordered({ dataIndex:"value" }, rows, "descend").map(row=>row.value)).toEqual(["Я","А",null]);
});
it("подписи и вычисляемые колонки сравниваются по видимому тексту без вызова действий", () => {
  const onClick = vi.fn();
  const rows = [{value:"a",label:"Яков"},{value:"z",label:"Анна"}];
  const column: ColumnType<Row> = {title:"Имя", render: (_, row) => createElement("button", {onClick}, row.label)};
  expect(ordered(column, rows)).toEqual([rows[1],rows[0]]);
  expect(ordered({...column,dataIndex:"value"},rows)).toEqual([rows[1],rows[0]]);
  expect(onClick).not.toHaveBeenCalled();
});
it("сохраняются собственные сортировщики, колонки действий не сортируются", () => {
  const sorter = vi.fn();
  expect(withColumnSorting<Row>({dataIndex:"value",sorter}).sorter).toBe(sorter);
  expect(withColumnSorting<Row>({title:"Действия",render:()=>"Удалить"}).sorter).toBeUndefined();
  expect(withColumnSorting<Row>({title:"",render:()=>"Открыть"}).sorter).toBeUndefined();
});
it("поддерживаются вложенные пути полей", () => {
  type Person = { person: { name: string }; roles: string[] };
  const people = [{person:{name:"Яков"},roles:["Исполнитель"]},{person:{name:"Анна"},roles:["Администратор"]}];
  const sorter = withColumnSorting<Person>({dataIndex:["person","name"]}).sorter;
  expect(typeof sorter === "function" && sorter(people[0]!,people[1]!)).toBeGreaterThan(0);
});
