import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TaskToolsPage } from "./task-tools";
import { apiFetch } from "../lib/api";
const session = vi.hoisted(() => ({ roles: ["chairman"] }));
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ roles: session.roles }) }));
vi.mock("../lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({items:[]}) }));
beforeEach(() => { session.roles = ["chairman"]; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it.each([false,true])("страница управления templates=%s открывается без кнопки К заданиям", templates => {
  render(<MemoryRouter><TaskToolsPage templates={templates} /></MemoryRouter>);
  expect(screen.getByRole("heading", {name:templates ? "Шаблоны заданий" : "Общие работы"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"К заданиям"})).not.toBeInTheDocument();
});
it("исполнитель не получает управление общими работами или шаблонами", () => {
  session.roles = ["executor"];
  render(<MemoryRouter><TaskToolsPage /></MemoryRouter>);
  expect(screen.getByText("Нет доступа к управлению заданиями.")).toBeInTheDocument();
  expect(apiFetch).not.toHaveBeenCalled();
});
