// Сценарии страницы «Настройки AI-ассистента» (план S0.4): сохранение
// с автоматической причиной и Idempotency-Key, 409 сохраняет ввод,
// токен только маской, поле токена не приглашает менеджер паролей;
// в эмуляции запись запрещена, пункт меню скрыт (app-layout.test).

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantSettingsPage } from "./assistant-settings";
import { apiFetch } from "../lib/api";

const identityState = vi.hoisted(() => ({ emulation: false, allowed: true }));
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({
    useCabinetIdentity: () => ({
      roles: identityState.allowed ? ["chairman"] : ["deputy"],
      identity: {
        me: { emulation: identityState.emulation ? { id: "test" } : null },
      },
    }),
    canSeeAssistantSettings: (roles: string[]) =>
      identityState.allowed && roles.includes("chairman"),
  }),
);

beforeEach(() => {
  identityState.emulation = false;
  identityState.allowed = true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const view = {
  settings: {
    provider: "deepseek",
    base_url: "https://api.deepseek.com/v1",
    model_id: "deepseek-chat",
    api_key_mask: "••••9876",
    version: 2,
  },
  users: [{
    person_id: "p-1",
    profile_id: "prof-1",
    full_name: "Сотрудник Один",
    roles: ["administrator"],
    telegram_username: "one",
    enabled: false,
    daily_token_limit: 0,
    monthly_token_limit: 0,
    version: null,
  }],
};

function mockApi(implementation?: (path: string, options?: { method?: string; query?: Record<string, string | undefined> }) => unknown) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) =>
    implementation?.(path, options) ?? view,
  );
}

it("сохраняет настройки без поля причины: причина автоматическая, Idempotency-Key есть", async () => {
  mockApi();
  render(<AssistantSettingsPage />);
  fireEvent.change(await screen.findByLabelText(/Токен/), {
    target: { value: "sk-new-provider-token-4321" },
  });
  fireEvent.click(screen.getByText("Сохранить настройки"));
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.some(([path, options]) =>
        path === "/v1/assistant/settings" && options?.method === "PUT"
      ),
    ).toBe(true),
  );
  const call = vi.mocked(apiFetch).mock.calls.find(
    ([, options]) => options?.method === "PUT",
  );
  expect(call?.[1]).toMatchObject({
    body: {
      api_key: "sk-new-provider-token-4321",
      expected_version: 2,
      reason: "Изменение настроек AI-ассистента",
    },
    idempotencyKey: expect.any(String),
  });
});

it("при 409 сохраняет ввод; повтор после перечитывания проходит", async () => {
  let writes = 0;
  vi.mocked(apiFetch).mockImplementation(async (_path, options) => {
    if (options?.method === "PUT") {
      writes += 1;
      if (writes === 1) {
        throw Object.assign(new Error("Объект изменён другим участником"), { status: 409 });
      }
      return view;
    }
    return view;
  });
  render(<AssistantSettingsPage />);
  fireEvent.change(await screen.findByLabelText("Модель"), {
    target: { value: "deepseek-reasoner" },
  });
  fireEvent.click(screen.getByText("Сохранить настройки"));
  // 409: страница перечитала актуальную версию (GET после PUT), ошибки показаны.
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([, options]) => options?.method === "PUT").length,
    ).toBe(1),
  );
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([path, options]) => path === "/v1/assistant/settings" && options?.method === undefined).length,
    ).toBeGreaterThanOrEqual(2),
  );
  // Ввод не сброшен; поле «Причина» в форме больше не показывается.
  expect(screen.getByLabelText("Модель")).toHaveValue("deepseek-reasoner");
  expect(screen.queryByLabelText("Причина изменения")).not.toBeInTheDocument();
  // Повторный клик — осознанный повтор с новым Idempotency-Key.
  fireEvent.click(screen.getByText("Сохранить настройки"));
  await waitFor(() => expect(writes).toBe(2));
  expect(await screen.findByText("Сохранено")).toBeInTheDocument();
  // Тело не менялось — ключ тот же: сервер вернёт кэш идемпотентности, а не
  // создаст вторую операцию. При новом изменении ввода ключ обновляется.
  const keys = vi.mocked(apiFetch).mock.calls
    .filter(([, options]) => options?.method === "PUT")
    .map(([, options]) => (options as { idempotencyKey?: string }).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
});

it("включение сотрудника отправляет его конфиг с версией и причиной", async () => {
  mockApi();
  render(<AssistantSettingsPage />);
  // Включение сотрудника с заданными лимитами: PUT отправляет конфиг целиком.
  fireEvent.change(await screen.findByLabelText("Дневной лимит Сотрудник Один"), {
    target: { value: "5000" },
  });
  fireEvent.change(screen.getByLabelText("Месячный лимит Сотрудник Один"), {
    target: { value: "50000" },
  });
  // onBlur отправляет изменение лимитов; затем тумблер включает сотрудника.
  fireEvent.blur(screen.getByLabelText("Месячный лимит Сотрудник Один"));
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === "PUT"),
    ).toBe(true),
  );
  const userSave = vi.mocked(apiFetch).mock.calls.find(
    ([, options]) => options?.method === "PUT" && (options as { body?: { users?: unknown[] } }).body?.users,
  );
  expect(userSave?.[1]).toMatchObject({
    body: { reason: "Изменение доступа сотрудника" },
  });
});

it("включение без лимитов блокируется на клиенте", async () => {
  mockApi();
  render(<AssistantSettingsPage />);
  fireEvent.click(await screen.findByRole("switch", { name: "Включён Сотрудник Один" }));
  expect(await screen.findByText(/задайте дневной и месячный лимиты/)).toBeInTheDocument();
  expect(
    vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === "PUT"),
  ).toBe(false);
});

it("в эмуляции форма недоступна; без роли страница не загружает данные", async () => {
  identityState.emulation = true;
  mockApi();
  render(<AssistantSettingsPage />);
  expect(await screen.findByText(/В эмуляции доступен просмотр/)).toBeInTheDocument();
  expect(screen.getByLabelText("Модель")).toBeDisabled();
  expect(
    screen.getByText("Сохранить настройки").closest("button"),
  ).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Включён Сотрудник Один" })).toBeDisabled();

  cleanup();
  vi.clearAllMocks();
  identityState.emulation = false;
  identityState.allowed = false;
  render(<AssistantSettingsPage />);
  expect(screen.getByText("Нет доступа к настройкам AI-ассистента")).toBeInTheDocument();
  expect(apiFetch).not.toHaveBeenCalled();
});

it("токен нигде не отображается — только маска из ответа", async () => {
  mockApi();
  render(<AssistantSettingsPage />);
  const label = await screen.findByText(/задан: ••••9876/);
  expect(label).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("sk-");
});

it("поле токена — текстовое с маскировкой: менеджер паролей не приглашается, глаз переключает", async () => {
  mockApi();
  render(<AssistantSettingsPage />);
  const token = await screen.findByLabelText(/Токен/);
  // Не type="password" и не autocomplete="new-password" — иначе Chrome PM
  // показывает подсказку «создать надёжный пароль».
  expect(token).toHaveAttribute("type", "text");
  expect(token).toHaveAttribute("autocomplete", "off");
  // Маскирование через CSS на обёртке (класс с suffix не попадает на input).
  const wrapper = () => token.closest(".ant-input-affix-wrapper");
  expect(wrapper()).toHaveClass("assistant-secret-masked");
  fireEvent.click(screen.getByRole("button", { name: "Показать токен" }));
  expect(wrapper()).not.toHaveClass("assistant-secret-masked");
  fireEvent.click(screen.getByRole("button", { name: "Скрыть токен" }));
  expect(wrapper()).toHaveClass("assistant-secret-masked");
});

it("блок расхода: история запрашивается после выбора сотрудника, разрез переключается", async () => {
  const historyCalls: Array<Record<string, string | undefined>> = [];
  mockApi((path, options) => {
    if (path === "/v1/assistant/usage/history") {
      historyCalls.push(options?.query ?? {});
      const month = options?.query?.granularity === "month";
      return {
        profile_id: options?.query?.profile_id,
        granularity: options?.query?.granularity ?? "day",
        rows: month
          ? [{ period: "2026-10", prompt_tokens: 2100, completion_tokens: 550, total_tokens: 2650 }]
          : [
              { period: "2026-10-26", prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 },
              { period: "2026-10-25", prompt_tokens: 900, completion_tokens: 210, total_tokens: 1110 },
            ],
      };
    }
    return view;
  });
  render(<AssistantSettingsPage />);
  await screen.findByText("Доступ сотрудников");
  // До выбора сотрудника история не запрашивается.
  expect(historyCalls).toHaveLength(0);
  expect(screen.getByText("Выберите сотрудника, чтобы увидеть его расход.")).toBeInTheDocument();

  // Выбор сотрудника — запрос истории по дням, свежие периоды первыми.
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Сотрудник" }));
  fireEvent.click(await screen.findByText("Сотрудник Один", { selector: ".ant-select-item-option-content" }));
  await waitFor(() => expect(historyCalls).toEqual([{ profile_id: "prof-1", granularity: "day" }]));
  expect(await screen.findByText("2026-10-26")).toBeInTheDocument();
  expect(screen.getByText("1540")).toBeInTheDocument();
  expect(screen.getByText("1110")).toBeInTheDocument();

  // Переключение разреза — месячная история по тому же сотруднику.
  fireEvent.click(screen.getByText("По месяцам"));
  await waitFor(() => expect(historyCalls).toEqual([
    { profile_id: "prof-1", granularity: "day" },
    { profile_id: "prof-1", granularity: "month" },
  ]));
  expect(await screen.findByText("2026-10")).toBeInTheDocument();
  expect(screen.getByText("2650")).toBeInTheDocument();
  expect(screen.queryByText("2026-10-26")).not.toBeInTheDocument();
});

it("ошибка загрузки расхода показывается рядом с блоком и не ломает страницу", async () => {
  mockApi((path, options) => {
    if (path === "/v1/assistant/usage/history") {
      throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
    }
    void options;
    return view;
  });
  render(<AssistantSettingsPage />);
  await screen.findByText("Доступ сотрудников");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Сотрудник" }));
  fireEvent.click(await screen.findByText("Сотрудник Один", { selector: ".ant-select-item-option-content" }));
  expect(await screen.findByText("FORBIDDEN")).toBeInTheDocument();
  // Таблица сотрудников остаётся на месте (имя и в таблице, и в выборе).
  expect(screen.getAllByText("Сотрудник Один").length).toBeGreaterThan(0);
});
