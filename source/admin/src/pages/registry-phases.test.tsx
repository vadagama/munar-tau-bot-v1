import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegistryPhasesPage } from "./registry-phases";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("ищет очереди по зданию, фильтрует по составу и сохраняет поиск после обновления", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => ({ items: path.endsWith("/buildings")
    ? [{ id: "b1", code: "107/1", construction_phase: 1 }, { id: "b2", code: "108/2", construction_phase: 2 }]
    : [{ id: "p1", building_id: "b1" }] }));
  render(<RegistryPhasesPage />);
  expect(await screen.findByText("107/1")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Поиск очередей"), { target: { value: "108/2" } });
  expect(screen.getByText("108/2")).toBeVisible();
  expect(screen.queryByText("107/1")).toBeNull();
  fireEvent(window, new Event("cabinet:refresh-page"));
  await waitFor(() => expect(screen.getByLabelText("Поиск очередей")).toHaveValue("108/2"));
  fireEvent.change(screen.getByLabelText("Поиск очередей"), { target: { value: "" } });
  fireEvent.mouseDown(screen.getByLabelText("Наличие зданий", { selector: "input" }));
  fireEvent.click(await screen.findByText("Без зданий", { selector: ".ant-select-item-option-content" }));
  expect(screen.queryByText("107/1")).toBeNull();
  expect(screen.queryByText("108/2")).toBeNull();
  expect(screen.getByText("5-я очередь", { selector: "td" })).toBeVisible();
});
it("показывает ошибку загрузки", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Нет доступа к реестру"));
  render(<RegistryPhasesPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет доступа к реестру");
});
