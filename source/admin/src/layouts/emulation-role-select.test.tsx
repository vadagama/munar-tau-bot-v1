import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmulationRoleSelect } from "./emulation-role-select";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../lib/use-page-refresh", () => ({ usePageRefresh: vi.fn() }));
const persons = [
  { person: { id: "r", full_name: "Тестовый житель" }, profile: { id: "resident" }, assignments: [] },
  { person: { id: "e", full_name: "Первый исполнитель" }, profile: { id: "executor-1" }, assignments: [{ id: "a", role: "executor" }] },
  { person: { id: "e2", full_name: "Второй исполнитель" }, profile: { id: "executor-2" }, assignments: [{ id: "b", role: "executor" }] },
];
beforeEach(() => { vi.mocked(apiFetch).mockResolvedValue({ persons }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("показывает плоский список уникальных ролей без имён персон и переключает сеанс", async () => {
  const onSwitched = vi.fn();
  render(<EmulationRoleSelect profileId="resident" onSwitched={onSwitched} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Роль эмуляции" })).toBeEnabled());
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Роль эмуляции" }));
  expect(screen.queryByText("Первый исполнитель")).toBeNull();
  expect(document.querySelector(".ant-select-item-group")).toBeNull();
  expect(screen.getAllByText("Тест: исполнитель", { selector: ".ant-select-item-option-content" })).toHaveLength(1);
  fireEvent.click(screen.getByText("Тест: исполнитель", { selector: ".ant-select-item-option-content" }));
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/sessions", {
    method: "POST", body: { emulated_profile_id: "executor-1" },
  }));
  await waitFor(() => expect(onSwitched).toHaveBeenCalledOnce());
});
it("ошибка переключения сохраняет текущую персону и показывает причину", async () => {
  const onSwitched = vi.fn();
  vi.mocked(apiFetch).mockResolvedValueOnce({ persons }).mockRejectedValueOnce(new Error("Персона недоступна"));
  render(<EmulationRoleSelect profileId="resident" onSwitched={onSwitched} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Роль эмуляции" })).toBeEnabled());
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Роль эмуляции" }));
  fireEvent.click(await screen.findByText("Тест: исполнитель", { selector: ".ant-select-item-option-content" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Персона недоступна");
  expect(screen.getByText("Тест: житель", { selector: ".ant-select-selection-item" })).toBeInTheDocument();
  expect(onSwitched).not.toHaveBeenCalled();
});
it("ошибка загрузки видна и не запускает смену сеанса", async () => {
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Нет доступа"));
  render(<EmulationRoleSelect profileId="resident" onSwitched={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет доступа");
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

it("блокирует повторное переключение до завершения запроса", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiFetch).mockResolvedValueOnce({ persons }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const onSwitched = vi.fn();
  render(<EmulationRoleSelect profileId="resident" onSwitched={onSwitched} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Роль эмуляции" })).toBeEnabled());
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Роль эмуляции" }));
  fireEvent.click(await screen.findByText("Тест: исполнитель", { selector: ".ant-select-item-option-content" }));
  expect(screen.getByRole("combobox", { name: "Роль эмуляции" })).toBeDisabled();
  expect(onSwitched).not.toHaveBeenCalled();
  finish({});
  await waitFor(() => expect(onSwitched).toHaveBeenCalledOnce());
});
