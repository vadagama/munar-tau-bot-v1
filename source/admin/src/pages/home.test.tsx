import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./home";
const harness = vi.hoisted(() => ({ widgets: [{ id: "action", title: "Требуют вашего действия", total: 132, href: "/requests?dashboard_queue=attention", items: Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: `Обращение ${i}`, href: `/requests?request=${i}`, state: "in_work", overdue: i === 0 })) }], profile: "p" }));
vi.mock("../lib/dashboard", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/dashboard")>(),
  useDashboardIdentity: () => ({ identity: { me: { profile: { id: harness.profile }, person: { id: harness.profile, is_test: false } } }, key: harness.profile }),
  useDashboardResource: () => ({ data: { widgets: harness.widgets, analytics: false, assistant: { state: "disabled" } }, loading: false }),
}));
// Панель ассистента — предмет assistant-panel.test.tsx; здесь она не рендерится.
vi.mock("../assistant/assistant-panel", () => ({ AssistantPanel: () => null }));
afterEach(() => { cleanup(); localStorage.clear(); harness.profile = "p"; });
describe("HomePage", () => {
  it("uses complete count and real entity links, without a duplicate overdue widget or disabled AI", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByTitle("132")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Обращение 0" })).toHaveAttribute("href", "/requests?request=0");
    expect(screen.queryByText(/Просрочено обращений:/)).not.toBeInTheDocument();
    expect(screen.queryByText("AI-ассистент")).not.toBeInTheDocument();
    expect(screen.queryByText("Обращение 5")).not.toBeInTheDocument();
  });
  it("restores the row limit and visibility only for the current person", () => {
    localStorage.setItem("dashboard:v1:p:p:false", JSON.stringify({ order: ["action"], hidden: [], limits: { action: 10 } }));
    const view = render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText("Обращение 9")).toBeInTheDocument();
    harness.profile = "other"; view.rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByText("Обращение 9")).not.toBeInTheDocument();
  });
  it("hides a widget through settings and persists the choice", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Настроить виджеты" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("switch", { name: "Показывать: Требуют вашего действия" }));
    expect(screen.queryByRole("link", { name: "Обращение 0" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("dashboard:v1:p:p:false")!).hidden).toEqual(["action"]);
  });
  it("shows a hidden widget again through settings", () => {
    localStorage.setItem("dashboard:v1:p:p:false", JSON.stringify({ order: ["action"], hidden: ["action"], limits: {} }));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Обращение 0" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Настроить виджеты" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("switch", { name: "Показывать: Требуют вашего действия" }));
    expect(screen.getByRole("link", { name: "Обращение 0" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("dashboard:v1:p:p:false")!).hidden).toEqual([]);
  });
});
