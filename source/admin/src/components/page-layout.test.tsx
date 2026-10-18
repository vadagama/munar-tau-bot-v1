import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PageLayout } from "./page-layout";
afterEach(cleanup);
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
