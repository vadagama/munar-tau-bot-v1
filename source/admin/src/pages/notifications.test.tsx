import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationsPage } from "./notifications";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({ useCabinetIdentity: () => ({ roles: ["administrator"] }) }),
);
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it(
  "ошибка доставки показывает задачу контакта, результат сохраняется явно",
  async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path.includes("preferences")
        ? {
          language: "ru",
          items: [{ event_type: "publication", mode: "digest" }, {
            event_type: "request.status",
            mode: "off",
          }],
        }
        : {
          items: [{
            id: "n",
            event_type: "request.required",
            full_name: "Тестовый житель",
            last_error: "BLOCKED_BY_USER",
            attempts: 1,
            followup_id: "f",
            followup_state: "open",
          }],
        }
    );
    render(<NotificationsPage section="failures" />);
    expect(await screen.findByText("Тестовый житель")).toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.includes("preferences"))).toBe(false);
    fireEvent.click(await screen.findByText("Записать результат связи"));
    fireEvent.change(screen.getByLabelText("Что удалось выяснить"), {
      target: { value: "Не ответил; повторить звонок завтра" },
    });
    fireEvent.click(await screen.findByText("Сохранить результат"));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/notifications/followups/f/complete",
        {
          method: "POST",
          body: { result: "Не ответил; повторить звонок завтра" },
        },
      )
    );
  },
  15000,
);
it("ошибка загрузки показана с повтором", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Нет соединения"));
  render(<NotificationsPage />);
  expect(await screen.findByText("Нет соединения")).toBeInTheDocument();
  expect(screen.getByText("Повторить")).toBeInTheDocument();
});


it("мои настройки не запрашивают ошибки доставки", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ language: "ru", items: [] });
  render(<NotificationsPage section="preferences" />);
  expect(await screen.findByText("Язык уведомлений")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual(["/v1/notifications/preferences"]);
  expect(screen.queryByText("Ошибки доставки")).toBeNull();
});
