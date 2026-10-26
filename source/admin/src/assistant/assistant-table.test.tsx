// Тесты табличного виджета агрегатов (S4a.2): заголовки и значения из контракта
// инструмента, числа форматируются текстом, HTML в значениях не исполняется,
// пустой набор — «Нет данных», ограничители 10 колонок и 50 строк.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantTable, type AssistantTableData } from "./assistant-table";

afterEach(cleanup);

const workload: AssistantTableData = {
  id: "workload_by_assignee",
  title: "Нагрузка по исполнителям",
  columns: [
    { key: "name", title: "Исполнитель", kind: "text" },
    { key: "open", title: "Открытые", kind: "number" },
    { key: "overdue", title: "Просрочено", kind: "number" },
  ],
  rows: [
    { name: "Петров Пётр", open: 3, overdue: 1 },
    { name: "Без исполнителя", open: 12, overdue: 0 },
  ],
};

describe("AssistantTable", () => {
  it("рендерит заголовок, колонки и значения из контракта", () => {
    render(<AssistantTable table={workload} />);
    expect(screen.getByRole("region", { name: "Нагрузка по исполнителям" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Исполнитель" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Открытые" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Петров Пётр" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Без исполнителя" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell")).toHaveLength(6);
  });

  it("числа отображаются текстом в ru-локали", () => {
    const withThousand: AssistantTableData = {
      ...workload,
      rows: [{ name: "Иванов И", open: 1200, overdue: 0 }],
    };
    render(<AssistantTable table={withThousand} />);
    expect(screen.getByRole("cell", { name: /1\s{1,2}200/ })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "12" })).toBeNull();
  });

  it("HTML в значениях остаётся текстом и не исполняется", () => {
    const hostile: AssistantTableData = {
      ...workload,
      rows: [{ name: '<script>window.__xss=1</script>', open: 1, overdue: 0 }],
    };
    render(<AssistantTable table={hostile} />);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/window.__xss/)).toBeInTheDocument();
  });

  it("пустой набор строк показывает «Нет данных»", () => {
    render(<AssistantTable table={{ ...workload, rows: [] }} />);
    expect(screen.getByText("Нет данных")).toBeInTheDocument();
  });

  it("ограничители: 10 колонок и 50 строк", () => {
    const columns = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, title: `К${i}`, kind: "number" as const }));
    const rows = Array.from({ length: 60 }, (_, i) => Object.fromEntries(columns.map((c) => [c.key, i])));
    render(<AssistantTable table={{ ...workload, columns, rows }} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(10);
    expect(screen.getAllByRole("row")).toHaveLength(51); // шапка + 50 строк
  });
});
