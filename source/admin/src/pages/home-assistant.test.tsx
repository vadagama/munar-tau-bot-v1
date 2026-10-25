import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { HomeAssistant } from "./home-assistant";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const enabled = { state: "enabled", remaining: 20, daily_limit: 20 } as const;
describe("home assistant", () => {
  it("does not call paid API on mount; disabled block disappears", () => {
    const view = render(<MemoryRouter><HomeAssistant status={enabled} /></MemoryRouter>);
    expect(screen.queryByText(/Осталось/)).not.toBeInTheDocument(); expect(apiFetch).not.toHaveBeenCalled();
    view.rerender(<MemoryRouter><HomeAssistant status={{ state: "disabled" }} /></MemoryRouter>);
    expect(screen.queryByText("AI-ассистент")).not.toBeInTheDocument();
  });
  it("sends only the question, renders text safely and provides server source links", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ text: '<script>alert(1)</script>\n\n[Обращения](ref:q0)', remaining: 19, sources: [{ ref: "ref:q0", title: "Обращения", total: 12, href: "/requests?dashboard_queue=attention" }], generated_at: "2026-10-25T00:00:00Z" });
    render(<MemoryRouter><HomeAssistant status={enabled} /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "Вопрос ассистенту" }), { target: { value: "Что требует внимания?" } });
    fireEvent.click(screen.getByRole("button", { name: "Спросить" }));
    await waitFor(() => expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith("/v1/dashboard/assistant", { method: "POST", body: { question: "Что требует внимания?" } });
    expect(screen.getByRole("link", { name: /Обращения/ })).toHaveAttribute("href", "/requests?dashboard_queue=attention");
    expect(screen.queryByText(/Осталось/)).not.toBeInTheDocument();
  });
  it("retains the twentieth answer when background refresh reports exhausted quota", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = render(<MemoryRouter><HomeAssistant status={{ ...enabled, remaining: 1 }} /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Сводка" } });
    fireEvent.click(screen.getByRole("button", { name: "Спросить" }));
    view.rerender(<MemoryRouter><HomeAssistant status={{ state: "limit", remaining: 0, daily_limit: 20 }} /></MemoryRouter>);
    await act(async () => resolve({ text: "Последний оплаченный ответ", remaining: 0, sources: [], generated_at: "2026-10-25T00:00:00Z" }));
    expect(screen.getByText("Последний оплаченный ответ")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("keeps quota exhausted compact and hides quota for unlimited tech access", () => {
    const view = render(<MemoryRouter><HomeAssistant status={{ state: "limit", remaining: 0, daily_limit: 20 }} /></MemoryRouter>);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.getByText(/Бесплатный лимит/)).toBeInTheDocument();
    view.rerender(<MemoryRouter><HomeAssistant status={{ state: "enabled", remaining: null, daily_limit: null }} /></MemoryRouter>);
    expect(screen.queryByText(/Без суточного лимита/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

it("shows configured subscription contacts only after the free limit", () => {
  const support = { telegram: "https://t.me/support_test", phone: "tel:+77001234567" };
  const view = render(<MemoryRouter><HomeAssistant status={{ ...enabled, support }} /></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "Позвонить" })).not.toBeInTheDocument();
  view.rerender(<MemoryRouter><HomeAssistant status={{ state: "limit", remaining: 0, daily_limit: 20, support }} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Написать в Telegram" })).toHaveAttribute("href", support.telegram);
  expect(screen.getByRole("link", { name: "Позвонить" })).toHaveAttribute("href", support.phone);
});
