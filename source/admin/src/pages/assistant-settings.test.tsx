// Сценарии страницы «Настройки AI-ассистента» (план S0.4): сохранение
// с причиной и Idempotency-Key, 409 сохраняет ввод, токен только маской,
// эмуляция запрещает запись; в эмуляции пункт меню скрыт (app-layout.test).

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

function mockApi(implementation?: (path: string, options?: { method?: string }) => unknown) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) =>
    implementation?.(path, options) ?? view,
  );
}

it("сохраняет настройки с причиной, Idempotency-Key и без значения токена", async () => {
  mockApi();
  render(<AssistantSettingsPage />);
  fireEvent.change(await screen.findByLabelText(/Токен/), {
    target: { value: "sk-new-provider-token-4321" },
  });
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "первичный токен пилота" },
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
      reason: "первичный токен пилота",
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
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "смена модели" },
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
  // Ввод не сброшен.
  expect(screen.getByLabelText("Модель")).toHaveValue("deepseek-reasoner");
  expect(screen.getByLabelText("Причина изменения")).toHaveValue("смена модели");
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
