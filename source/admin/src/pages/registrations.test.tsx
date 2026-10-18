import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegistrationsPage } from "./registrations";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));

const registration = {
  id: "reg-1",
  state: "pending_review",
  draft: { full_name: "Иван Иванов", phone_e164: "+79990000002" },
  building_code: "Д1",
  kind: "apartment",
  number: "12",
  role: "owner",
  stage_due_at: "2026-10-20T10:00:00Z",
  overdue_at: null,
};
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element),
  );
  localStorage.clear();
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/registrations" ? { items: [registration] } : { items: [] },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

it("доска регистраций: заявитель на карточке, решения доступны", async () => {
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Доска" }));
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  expect(screen.getByText("Д1 · Квартира 12")).toBeInTheDocument();
  expect(screen.getByText(/Собственник/)).toBeInTheDocument();
  expect(screen.getByText("Ожидает проверки")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Отказать" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("переключение на таблицу сохраняет прежний вид с фильтром состояний", async () => {
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Доска" }));
  fireEvent.click(screen.getByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Подтвердить" })).toBeInTheDocument();
});
