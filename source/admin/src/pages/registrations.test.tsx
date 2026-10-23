import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegistrationsPage } from "./registrations";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));

const registration = {
  id: "reg-1",
  state: "pending_review",
  draft: { full_name: "Иван Иванов", phone_e164: "+79990000002" },
  telegram_username: "w84gr8",
  premises_id: "p1",
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
  // Имя в Telegram показывается и на карточке, и в таблице, и кликается.
  const cardLink = screen.getByRole("link", { name: "@w84gr8" });
  expect(cardLink).toHaveAttribute("href", "https://t.me/w84gr8");
  expect(screen.getAllByText("@w84gr8").length).toBeGreaterThanOrEqual(1);
  // Уточнение временно скрыто (решение владельца 24.10.2026).
  expect(screen.queryByText("Уточнить")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Отказать" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("поиск анкет находит по Telegram-имени и фильтрует таблицу", async () => {
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  const tableLink = screen.getByRole("link", { name: "@w84gr8" });
  expect(tableLink).toHaveAttribute("href", "https://t.me/w84gr8");
  const search = screen.getByRole("searchbox", { name: "Поиск анкет" });
  fireEvent.change(search, { target: { value: "@w84" } });
  expect(screen.getByText("Иван Иванов")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "нет такого" } });
  expect(screen.getByText("По выбранным условиям ничего не найдено")).toBeInTheDocument();
  expect(screen.queryByText("Иван Иванов")).toBeNull();
});

it("переключение на таблицу сохраняет прежний вид с фильтром состояний", async () => {
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Доска" }));
  fireEvent.click(screen.getByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Подтвердить" })).toBeInTheDocument();
});

const liteRegistration = {
  id: "reg-2",
  state: "pending_review",
  draft: { full_name: "Пётр Петров", phone_e164: "+79990000003" },
  premises_id: null,
  building_code: null,
  kind: null,
  number: null,
  role: null,
  stage_due_at: "2026-10-20T10:00:00Z",
  overdue_at: null,
};

it("анкета без помещения: карточка и таблица без дома, подтверждение доступно", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/registrations"
      ? { items: [liteRegistration] }
      : { items: [] },
  );
  render(<RegistrationsPage />);
  expect(await screen.findByText("Пётр Петров")).toBeInTheDocument();
  // На доске и в таблице — «Помещение не указано», без «null» и пустых меток.
  const places = await screen.findAllByText("Помещение не указано");
  expect(places.length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^\s*·\s/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Таблица" }));
  expect(await screen.findAllByText("Помещение не указано")).not.toHaveLength(0);
  expect(screen.getAllByText("Подтвердить").length).toBeGreaterThanOrEqual(1);
});

it("анкета без помещения: подтверждение создаёт доступ без привязки", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/registrations"
      ? { items: [liteRegistration] }
      : { items: [] },
  );
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Подтвердить" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Пётр Петров");
  expect(dialog).toHaveTextContent(
    /доступ к обращениям без привязки к помещению/,
  );
  expect(dialog).not.toHaveTextContent("подтверждается доступ:");
});

it("подтверждённая анкета: уточнение, спор и исправление скрыты, удаление доступно", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/registrations"
    ? { items: [{ ...registration, state: "approved", version: 3, can_manage: true }] } : { items: [] });
  render(<RegistrationsPage />);
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  // Временно скрыты (решение владельца 24.10.2026): эндпоинты clarify/dispute
  // и manage(operation:"edit") сохранены — кнопки возвращаются в decisionButtons.
  expect(screen.queryByText("Уточнить")).toBeNull();
  expect(screen.queryByText("Открыть спор")).toBeNull();
  expect(screen.queryByText("Исправить")).toBeNull();
  expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
});

it("удаление предупреждает о закрытии доступа и требует причину", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/registrations"
    ? { items: [{ ...liteRegistration, state: "approved", version: 3, can_manage: true }] } : { items: [] });
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
  expect(await screen.findByText(/Доступ к боту и кабинету закроется/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Удалить анкету" }));
  expect(await screen.findByText("Укажите основание")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith("/manage"))).toBe(false);
});
