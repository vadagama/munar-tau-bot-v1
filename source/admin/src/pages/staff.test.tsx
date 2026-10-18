import { PAGE_REFRESH_EVENT } from "../lib/use-page-refresh";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StaffPage } from "./staff";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({
    useCabinetIdentity: () => ({
      roles: ["chairman"],
      identity: { me: { person: { id: "chair" } } },
    }),
  }),
);
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => computed(el));
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const detail = {
  id: "worker",
  full_name: "Иван Тестов",
  phone_e164: "+70000000000",
  roles: ["executor"],
  effective_roles: ["executor"],
  version: "v1",
  can_edit: true,
  workload: { tasks: 2, requests: 1, schedules: 0 },
  history: [],
  assignments: [],
};
function setup() {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === "/v1/staff") {
      return {
        items: [{ ...detail, open_tasks: 2 }],
        available_roles: [
          "administrator",
          "deputy",
          "executor",
          "duty",
          "finance",
          "doc_reviewer",
        ],
        can_edit: true,
      };
    }
    if (path === "/v1/staff/worker/roles" && options?.method === "POST") {
      return { id: "worker", roles: [], version: "v2" };
    }
    if (path === "/v1/staff/worker") return detail;
    if (path.startsWith("/v1/staff/candidates")) return { items: [] };
    throw Error(path);
  });
}
it("редактирует перечень ролей в единственной шторке без домов и сроков", async () => {
  setup();
  render(<StaffPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Иван Тестов" }));
  fireEvent.click(await screen.findByRole("button", { name: "Изменить роли" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Дежурный" }));
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Дежурство" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Сохранить роли",
    }),
  );
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/staff/worker/roles",
      expect.objectContaining({
        method: "POST",
        idempotencyKey: expect.any(String),
        body: {
          roles: ["executor", "duty"],
          expected_version: "v1",
          reason: "Дежурство",
        },
      }),
    )
  );
  expect(screen.queryByLabelText("Дома")).toBeNull();
  expect(screen.queryByLabelText("Срок полномочий")).toBeNull();
});
it("прекращение полномочий показывает обязанности и отправляет пустой перечень с причиной", async () => {
  setup();
  render(<StaffPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Иван Тестов" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Прекратить полномочия" }),
  );
  expect(
    (await screen.findAllByText(/Задания: 2/)).some((el) =>
      el.textContent?.includes("расписания")
    ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Завершение работы" },
  });
  const buttons = within(screen.getByRole("dialog")).getAllByRole("button", {
    name: "Прекратить полномочия",
  });
  fireEvent.click(buttons.find((b) => !b.hasAttribute("disabled"))!);
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/staff/worker/roles",
      expect.objectContaining({
        body: {
          roles: [],
          expected_version: "v1",
          reason: "Завершение работы",
        },
      }),
    )
  );
});

it("добавляет зарегистрированного пользователя с выбранной ролью", async () => {
  setup();
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, opts) => {
    if (path.startsWith("/v1/staff/candidates")) {
      return {
        items: [{
          id: "new",
          full_name: "Новый Тестов",
          phone_e164: "+70000000001",
        }],
      };
    }
    if (path === "/v1/staff/new") {
      return {
        ...detail,
        id: "new",
        full_name: "Новый Тестов",
        roles: [],
        version: "empty",
      };
    }
    if (path === "/v1/staff/new/roles") {
      return { id: "new", roles: ["duty"], version: "added" };
    }
    return original(path, opts);
  });
  render(<StaffPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Добавить сотрудника" }),
  );
  expect(apiFetch).toHaveBeenCalledWith("/v1/staff/candidates/search", {
    method: "POST",
    body: { query: "" },
  });
  fireEvent.mouseDown(
    screen.getByRole("combobox", { name: "Зарегистрированный пользователь" }),
  );
  fireEvent.click(await screen.findByText("Новый Тестов · +70000000001"));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/staff/new"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Дежурный" }));
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Приём на работу" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Добавить сотрудника",
    }),
  );
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/staff/new/roles",
      expect.objectContaining({
        method: "POST",
        body: {
          roles: ["duty"],
          reason: "Приём на работу",
          expected_version: "empty",
        },
      }),
    )
  );
});
it("409 сохраняет выбранные роли и причину, обновляет версию без автоматической повторной записи", async () => {
  setup();
  let reads = 0, writes = 0;
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, opts) => {
    if (path === "/v1/staff/worker") {
      return { ...detail, version: ++reads === 1 ? "v1" : "v2" };
    }
    if (path === "/v1/staff/worker/roles") {
      writes++;
      throw Object.assign(Error("Конфликт"), { status: 409 });
    }
    return original(path, opts);
  });
  render(<StaffPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Иван Тестов" }));
  fireEvent.click(await screen.findByRole("button", { name: "Изменить роли" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Дежурный" }));
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Новая обязанность" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Сохранить роли",
    }),
  );
  await screen.findByText(/Данные обновлены, ваш ввод сохранён/);
  expect(screen.getByLabelText("Причина изменения")).toHaveValue(
    "Новая обязанность",
  );
  expect(screen.getByRole("checkbox", { name: "Дежурный" })).toBeChecked();
  expect(writes).toBe(1);
});

it("ошибка фонового чтения сохраняет открытое редактирование и введённую причину", async () => {
  setup();
  let fail = false;
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, opts) => {
    if (path === "/v1/staff" && fail) throw Error("Временная ошибка сети");
    return original(path, opts);
  });
  render(<StaffPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Иван Тестов" }));
  fireEvent.click(await screen.findByRole("button", { name: "Изменить роли" }));
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Сохранить мой ввод" },
  });
  fail = true;
  await act(async () => {
    window.dispatchEvent(new Event(PAGE_REFRESH_EVENT));
  });
  expect(screen.getByLabelText("Причина изменения")).toHaveValue(
    "Сохранить мой ввод",
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
