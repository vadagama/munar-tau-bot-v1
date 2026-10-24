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
  created_at: "2026-10-24T08:30:00Z",
  withdrawn_at: null,
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

it("таблица: дата регистрации вместо срока, дата отзыва скрыта по умолчанию", async () => {
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Дата регистрации" })).toBeInTheDocument();
  // Дата подачи — по Алматы; прежняя колонка «Срок» больше не показывается.
  expect(screen.getByText(/24\.10\.2026/, { selector: "td" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Срок" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Дата отзыва" })).toBeNull();
  // Просрочка — атрибут состояния, а не отдельная колонка срока.
  expect(screen.queryByText("Просрочено")).toBeNull();
});

it("таблица: дата отзыва включается в настройках колонок", async () => {
  vi.mocked(apiFetch).mockImplementation(async path =>
    path === "/v1/registrations"
      ? { items: [{ ...registration, state: "withdrawn", can_manage: false, withdrawn_at: "2026-10-23T10:00:00Z" }] }
      : { items: [] });
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Иван Иванов")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
  const checkbox = await screen.findByRole("checkbox", { name: "Дата отзыва" });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  expect(screen.getByRole("columnheader", { name: "Дата отзыва" })).toBeInTheDocument();
  expect(screen.getByText(/23\.10\.2026/, { selector: "td" })).toBeInTheDocument();
});

it("таблица: просрочка показывается в состоянии анкеты", async () => {
  vi.mocked(apiFetch).mockImplementation(async path =>
    path === "/v1/registrations"
      ? { items: [{ ...registration, overdue_at: "2026-10-22T10:00:00Z" }] }
      : { items: [] });
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Ожидает проверки")).toBeInTheDocument();
  expect(screen.getByText("Просрочено")).toBeInTheDocument();
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

it("анкета-минимум: без помещения в таблице и на доске, подтверждение доступно", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/registrations"
      ? { items: [liteRegistration] }
      : { items: [] },
  );
  render(<RegistrationsPage />);
  expect(await screen.findByText("Пётр Петров")).toBeInTheDocument();
  // Раздел регистраций — только факты анкеты: помещение и отношение не выводятся
  // (решение владельца 24.10.2026), привязки — в /registry/connections.
  expect(screen.queryByText("Помещение")).toBeNull();
  expect(screen.queryByText("Отношение")).toBeNull();
  expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Доска" }));
  expect(await screen.findByText("Пётр Петров")).toBeInTheDocument();
  expect(screen.queryByText("Помещение не указано")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Таблица" }));
  expect(await screen.findByText("Пётр Петров")).toBeInTheDocument();
  expect(screen.getAllByText("Подтвердить").length).toBeGreaterThanOrEqual(1);
});

it("анкета-минимум: подтверждение открывает доступ без упоминания привязки", async () => {
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
    /открывается доступ к обращениям/,
  );
  expect(dialog).not.toHaveTextContent("привязк");
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

it("журнал: клик по имени заявителя открывает историю статусов и все анкеты", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === "/v1/registrations")
      return { items: [{ ...liteRegistration, state: "approved", person_id: "person-1", can_manage: true }] };
    if (String(path).startsWith("/v1/registrations/journal"))
      return {
        person: { id: "person-1", full_name: "Пётр Петров", phone_e164: "+79990000003" },
        registrations: [
          { id: "main", state: "approved", premises_id: null, superseded_by: null, created_at: "2026-10-23T18:42:00Z", decided_at: "2026-10-23T20:42:00Z", withdrawn_at: null, building_code: null, number: null },
          { id: "attach", state: "approved", premises_id: "p4", superseded_by: null, created_at: "2026-10-23T21:09:00Z", decided_at: "2026-10-23T21:09:00Z", withdrawn_at: null, building_code: "Д1", number: "4" },
        ],
        events: [
          { at: "2026-10-23T18:42:00Z", action: "registration.submit", before: null, after: { state: "pending_review" }, reason: null, actor_name: "Пётр Петров" },
          { at: "2026-10-23T20:42:00Z", action: "registration.approve", before: { state: "pending_review" }, after: { state: "approved" }, reason: "Проверено по реестру", actor_name: "Администратор ОСИ" },
          { at: "2026-10-23T21:09:00Z", action: "registration.approve", before: { state: "pending_review" }, after: { state: "approved" }, reason: "Привязка подтверждена", actor_name: "Администратор ОСИ" },
        ],
      };
    return { items: [] };
  });
  render(<RegistrationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Пётр Петров" }));
  expect(await screen.findByText("История статусов")).toBeInTheDocument();
  // Обе анкеты видны: основная и привязка — привязка не отдельная регистрация в списке.
  expect(screen.getByText("Основная анкета")).toBeInTheDocument();
  expect(screen.getByText(/Привязка · Д1, 4/)).toBeInTheDocument();
  // История смен статусов: подача → подтверждение, с причиной и актором.
  expect(screen.getByText("Подача анкеты")).toBeInTheDocument();
  expect(screen.getAllByText("Подтверждена").length).toBe(2);
  expect(screen.getByText("Причина: Проверено по реестру")).toBeInTheDocument();
  expect(screen.getAllByText(/Администратор ОСИ/).length).toBeGreaterThanOrEqual(2);
});

it("журнал: имя без карточки реестра не кликается", async () => {
  vi.mocked(apiFetch).mockImplementation(async path =>
    path === "/v1/registrations" ? { items: [liteRegistration] } : { items: [] });
  render(<RegistrationsPage />);
  expect(await screen.findByText("Пётр Петров")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Пётр Петров" })).toBeNull();
});
