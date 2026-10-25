import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AssistantRichText } from "./assistant-rich-text";
afterEach(cleanup);
it("renders headings, emphasis, emoji, bullets and a semantic table", () => {
  render(<AssistantRichText text={'### 📌 Главное\n\nЕсть **8 обращений**.\n\n- Уточнить сроки\n- Проверить очередь\n\n| Очередь | Записей |\n| --- | ---: |\n| Новые | 8 |'} />);
  expect(screen.getByRole("heading", { name: "📌 Главное" })).toBeInTheDocument();
  expect(screen.getByText("8 обращений").tagName).toBe("STRONG");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Записей" })).toBeInTheDocument();
});
it("keeps HTML and invented links as inert text", () => {
  const view = render(<AssistantRichText text={'<script>alert(1)</script>\n\n[Открыть](javascript:alert(1))\n\n![image](https://example.com/track)'} />);
  expect(view.container.querySelectorAll('script,img,a')).toHaveLength(0);
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
});
it("links only server-authorized lists and cards, including inside tables", () => {
  render(<MemoryRouter><AssistantRichText text={'Откройте [Новые](ref:q0).\n\n| Карточка | Действие |\n| --- | --- |\n| **[Неверная подпись №999](ref:e1)** | Проверить |\n\n[Чужая](/requests?request=other) [Внешняя](https://example.com)'} sources={[{ ref: "ref:q0", title: "Новые", href: "/requests?dashboard_queue=new" }, { ref: "ref:e1", title: "№120", href: "/requests?request=allowed&entity_page=1" }]} /></MemoryRouter>);
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "№120" })).toHaveAttribute("href", "/requests?request=allowed&entity_page=1");
});
it("does not add a table or chart to a plain answer", () => {
  render(<AssistantRichText text="Краткий ответ" sources={[{ title: "Очередь", total: 8, href: "/requests" }]} />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("figure")).not.toBeInTheDocument();
});

it("does not amplify malformed wide tables into a huge DOM", () => {
  const headers = Array(100).fill("h").join("|");
  const separators = Array(100).fill("---").join("|");
  const rows = Array(100).fill("| x |").join("\n");
  const view = render(<AssistantRichText text={`${headers}\n${separators}\n${rows}`} />);
  expect(view.container.querySelectorAll("td,th")).toHaveLength(0);
  expect(view.container.querySelector("pre")).toBeInTheDocument();
});
