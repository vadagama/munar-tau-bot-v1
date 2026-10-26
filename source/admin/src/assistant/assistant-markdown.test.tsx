// Тесты рендера ответа ассистента (S1.2): Markdown-подмножество React-нодами,
// HTML из ответа модели не рендерится, ссылки — только из серверных sources
// по allow-list путей, обрезка 24000 символов (решение 25.10.2026).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AssistantMarkdown } from "./assistant-markdown";

afterEach(cleanup);

function renderText(text: string, sources?: Parameters<typeof AssistantMarkdown>[0]["sources"]) {
  return render(<MemoryRouter><AssistantMarkdown text={text} sources={sources} /></MemoryRouter>);
}

describe("AssistantMarkdown", () => {
  it("рендерит жирный, код, заголовок и список", () => {
    renderText("# Сводка\n\n**Важно**: проверьте `№42`\n\n- первый\n- второй\n");
    expect(screen.getByRole("heading", { name: "Сводка" })).toBeInTheDocument();
    expect(screen.getByText("Важно").closest("strong")).toBeInTheDocument();
    expect(screen.getByText("№42").closest("code")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("HTML и script из ответа остаются текстом и не исполняются", () => {
    renderText('Привет <script>window.__xss=1</script> и <img src=x onerror="alert(1)">');
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/<script>/)).toBeInTheDocument();
    expect(screen.getByText(/<img/)).toBeInTheDocument();
  });

  it("ссылка модели без серверного source не становится ссылкой", () => {
    renderText("Смотрите [карточку](/requests?request=1)");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/карточку/)).toBeInTheDocument();
  });

  it("ссылка из sources по allow-list путей рендерится Link", () => {
    renderText("Смотрите [карточку](ref-1)", [
      { title: "Обращение №1", href: "/requests?request=1", ref: "ref-1" },
    ]);
    const link = screen.getByRole("link", { name: "Обращение №1" });
    expect(link).toHaveAttribute("href", "/requests?request=1");
  });

  it("ссылка source вне allow-list путей отбрасывается", () => {
    renderText("Открой [админку](ref-2)", [
      { title: "Админка", href: "https://evil.example", ref: "ref-2" },
    ]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("таблица рендерится с заголовками, превышение размеров — текстом", () => {
    renderText("| Задание | Срок |\n| --- | --- |\n| Ремонт | 01.11 |\n");
    expect(screen.getByRole("region", { name: "Таблица ответа" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Срок" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ремонт" })).toBeInTheDocument();
  });

  it("длинный ответ обрезается до 24000 символов", () => {
    renderText("x".repeat(30000));
    expect(document.body.textContent!.length).toBeLessThanOrEqual(24100);
  });
});
