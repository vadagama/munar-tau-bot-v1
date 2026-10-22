import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Table } from "antd";
import { useTableColumns } from "./table-columns";

const columns = [
  { key: "number", title: "Номер", dataIndex: "number" },
  { key: "description", title: "Описание", dataIndex: "description" },
];
function Harness({ storageKey = "columns.tasks" }: { storageKey?: string }) {
  const configured = useTableColumns(storageKey, columns);
  return <>{configured.settings}<Table columns={configured.columns} dataSource={[]} /></>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("скрывает выбранную колонку, сохраняет настройку и восстанавливает все колонки", async () => {
  const first = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
  const settings = await screen.findByRole("group", { name: "Видимые колонки" });
  expect(within(settings).getByRole("checkbox", { name: "Номер" })).toBeDisabled();
  fireEvent.click(within(settings).getByRole("checkbox", { name: "Описание" }));
  expect(screen.queryByRole("columnheader", { name: "Описание" })).not.toBeInTheDocument();
  first.unmount();
  render(<Harness />);
  expect(screen.queryByRole("columnheader", { name: "Описание" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
  fireEvent.click(await screen.findByRole("button", { name: "Все колонки" }));
  expect(screen.getByRole("columnheader", { name: "Описание" })).toBeInTheDocument();
});
it("настройки заданий и обращений независимы, повреждённое хранилище не ломает таблицу", () => {
  localStorage.setItem("columns.tasks", JSON.stringify(["description"]));
  localStorage.setItem("columns.requests", "broken");
  render(<Harness storageKey="columns.requests" />);
  expect(screen.getByRole("columnheader", { name: "Описание" })).toBeInTheDocument();
});
it("номер нельзя скрыть даже через сохранённую настройку, неизвестные колонки игнорируются", () => {
  localStorage.setItem("columns.tasks", JSON.stringify(["number", "removed"]));
  render(<Harness />);
  expect(screen.getByRole("columnheader", { name: "Номер" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Описание" })).toBeInTheDocument();
});

it("недоступный localStorage не мешает переключать колонки", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
  const settings = await screen.findByRole("group", { name: "Видимые колонки" });
  fireEvent.click(within(settings).getByRole("checkbox", { name: "Описание" }));
  expect(screen.queryByRole("columnheader", { name: "Описание" })).not.toBeInTheDocument();
});
