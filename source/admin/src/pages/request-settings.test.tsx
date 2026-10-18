import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RequestSettingsPage } from "./request-settings";
import { apiFetch } from "../lib/api";
const state = vi.hoisted(() => ({ roles: ["chairman"], identity: { me: { emulation: null as object | null } } }));
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => state }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("настройки открываются страницей и сохраняют категории прежним API", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/request-categories" ? { items: [] } : {
    max_bytes: 20971520, max_per_message: 10, extensions: ["pdf"],
  });
  render(<RequestSettingsPage />);
  expect(screen.getByRole("heading", { name: "Настройки обращений" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.change(screen.getByLabelText("Название на русском"), { target: { value: "Сантехника" } });
  fireEvent.change(screen.getByLabelText("Название на казахском"), { target: { value: "Сантехника" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить категорию" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/request-categories", {
    method: "POST", body: { name_ru: "Сантехника", name_kk: "Сантехника", sort: 0, active: true },
  }));
});
it("прямая ссылка в эмуляции не загружает настройки", () => {
  state.identity.me.emulation = {};
  render(<RequestSettingsPage />);
  expect(screen.getByText(/вне эмуляции/)).toBeInTheDocument();
  expect(apiFetch).not.toHaveBeenCalled();
  state.identity.me.emulation = null;
});
