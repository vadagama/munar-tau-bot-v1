import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmulationPage } from "./emulation";
vi.mock("../lib/identity", () => ({ useCabinetIdentity: () => ({ identity: { me: { emulation: null } } }) }));
vi.mock("../lib/use-page-refresh", () => ({ usePageRefresh: vi.fn() }));
vi.mock("../lib/api", () => ({
  ApiClientError: class extends Error {},
  apiFetch: vi.fn().mockResolvedValue({ persons: [
    { person: { id: "resident", full_name: "Тестовый житель" }, profile: { id: "resident-profile" }, assignments: [] },
    { person: { id: "staff", full_name: "Тестовый сотрудник" }, profile: { id: "staff-profile" }, assignments: [{ id: "role", role: "executor" }] },
  ] }),
}));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("показывает жителя без служебных назначений и позволяет выбрать его роль", async () => {
  render(<EmulationPage />);
  expect(await screen.findByText("Тестовый житель")).toBeInTheDocument();
  expect(screen.getByText("Тестовый сотрудник")).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Роль тестовой персоны" }));
  fireEvent.click(screen.getByText("Житель", { selector: ".ant-select-item-option-content" }));
  await waitFor(() => expect(screen.queryByText("Тестовый сотрудник")).not.toBeInTheDocument());
  expect(screen.getByText("Тестовый житель")).toBeInTheDocument();
});
