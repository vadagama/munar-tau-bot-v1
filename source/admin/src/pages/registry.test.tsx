import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegistryPage } from "./registry";
import { apiFetch } from "../lib/api";

vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("восстановление Telegram — самостоятельная форма в шторке с отменой", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({
    items: path === "/v1/registry/persons"
      ? [{ id: "person", full_name: "Иван Петров", phone_e164: "+77010000000" }]
      : [],
  }));
  render(<RegistryPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Лица" }));
  fireEvent.click(await screen.findByRole("button", { name: "Восстановить Telegram" }));
  const field = await screen.findByLabelText("Как проверены личность и новый Telegram-аккаунт");
  const drawer = screen.getByRole("dialog");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  // Для отдельной формы важно и размещение: одна Modal здесь тоже была бы одним dialog.
  expect(field.closest(".ant-drawer-body")).not.toBeNull();
  expect(within(drawer).getByLabelText("Анкета с нового Telegram")).toBeInTheDocument();
  expect(within(drawer).getByText(/Прежняя привязка и все прежние сеансы/)).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Отмена" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(apiFetch).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
});
