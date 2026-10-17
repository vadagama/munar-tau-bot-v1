import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TemplatesPage } from "./templates";
import { apiFetch } from "../lib/api";
const identityState = vi.hoisted(() => ({ emulation: false, allowed: true }));
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({
    useCabinetIdentity: () => ({
      roles: ["administrator"],
      identity: {
        me: { emulation: identityState.emulation ? { id: "test" } : null },
      },
    }),
    canSeeTemplates: () => identityState.allowed,
  }),
);
// CSS-видимость всех узлов AntD в jsdom дорого вычисляется. Проверяем
// действия и имена; визуальные состояния проверены отдельно в браузере.
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  identityState.emulation = false;
  identityState.allowed = true;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const row = {
  key: "errors.INTERNAL",
  section: "errors",
  title: "Техническая ошибка",
  description: "Ошибка бота",
  variables: [],
  default_ru: "Сбой",
  default_kk: "Қате",
  active: null,
  overridden: false,
};
it("сохраняет пару языков с причиной и исходной версией", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path.endsWith("/versions") ? { items: [] } : { items: [row] }
  );
  render(<TemplatesPage />);
  fireEvent.click(
    await screen.findByText("Техническая ошибка"),
  );
  fireEvent.change(screen.getByLabelText("Русский"), {
    target: { value: "Попробуйте позже" },
  });
  fireEvent.change(screen.getByLabelText("Қазақша"), {
    target: { value: "Кейінірек көріңіз" },
  });
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Понятный текст" },
  });
  fireEvent.click(screen.getByText("Сохранить версию"));
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.some(([p, o]) =>
        p === "/v1/templates/errors.INTERNAL" && o?.method === "POST"
      ),
    ).toBe(true)
  );
  expect(
    vi.mocked(apiFetch).mock.calls.find(([, o]) => o?.method === "POST")?.[1],
  ).toMatchObject({
    body: {
      text_ru: "Попробуйте позже",
      text_kk: "Кейінірек көріңіз",
      reason: "Понятный текст",
      base_version: 0,
    },
    idempotencyKey: expect.any(String),
  });
});

it("предпросмотр использует сервер, сброс создаёт версию с причиной", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path.endsWith("/versions")
      ? { items: [] }
      : path.endsWith("/preview")
      ? { ru: "<b>Проверено</b>", kk: "Дайын" }
      : {
        items: [{
          ...row,
          overridden: true,
          active: { version: 3, text_ru: "Один", text_kk: "Бір" },
        }],
      }
  );
  render(<TemplatesPage />);
  fireEvent.click(
    await screen.findByText("Техническая ошибка"),
  );
  fireEvent.click(screen.getByText("Предпросмотр"));
  expect(await screen.findByText("Проверено")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Вернуть стандарт" },
  });
  fireEvent.click(screen.getByText("Сбросить к дефолту"));
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.some(([, o]) =>
        (o?.body as { use_default?: boolean })?.use_default
      ),
    ).toBe(true)
  );
  expect(
    vi.mocked(apiFetch).mock.calls.find(([, o]) =>
      (o?.body as { use_default?: boolean })?.use_default
    )?.[1]?.body,
  ).toEqual({ use_default: true, reason: "Вернуть стандарт", base_version: 3 });
});

it("эмуляция разрешает чтение без записи; чужая роль не загружает каталог", async () => {
  identityState.emulation = true;
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path.endsWith("/versions") ? { items: [] } : { items: [row] }
  );
  render(<TemplatesPage />);
  fireEvent.click(
    await screen.findByText("Техническая ошибка"),
  );
  expect(screen.getByText("Сохранить версию").closest("button"))
    .toBeDisabled();
  expect(screen.getByLabelText("Русский")).toBeDisabled();
  cleanup();
  vi.clearAllMocks();
  identityState.allowed = false;
  render(<TemplatesPage />);
  expect(screen.getByText("Нет доступа к шаблонам")).toBeInTheDocument();
  expect(apiFetch).not.toHaveBeenCalled();
});
it("откат передаёт номер версии и обязательную причину", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path.endsWith("/versions")
      ? {
        items: [{
          version: 1,
          text_ru: "Первый",
          text_kk: "Бірінші",
          reason: "Исходный",
          author: "Тест",
          created_at: "2026-10-18T00:00:00Z",
        }],
      }
      : {
        items: [{
          ...row,
          active: { version: 2, text_ru: "Второй", text_kk: "Екінші" },
          overridden: true,
        }],
      }
  );
  render(<TemplatesPage />);
  fireEvent.click(
    await screen.findByText("Техническая ошибка"),
  );
  fireEvent.click(await screen.findByText(/Версия 1/));
  fireEvent.click(screen.getByText("Сделать активной"));
  expect(screen.getByText("Укажите причину изменения")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Причина изменения"), {
    target: { value: "Вернуть текст" },
  });
  fireEvent.click(screen.getByText("Сделать активной"));
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.some(([, o]) =>
        (o?.body as { rollback_to?: number })?.rollback_to === 1
      ),
    ).toBe(true)
  );
  expect(
    vi.mocked(apiFetch).mock.calls.find(([, o]) =>
      (o?.body as { rollback_to?: number })?.rollback_to === 1
    )?.[1]?.body,
  ).toEqual({ rollback_to: 1, reason: "Вернуть текст", base_version: 2 });
});
it("вставляет переменную в выбранное место активного языка", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path.endsWith("/versions") ? { items: [] } : {
      items: [{
        ...row,
        variables: [{
          name: "number",
          description: "Номер обращения",
          example: "З-1",
        }],
      }],
    }
  );
  render(<TemplatesPage />);
  fireEvent.click(
    await screen.findByText("Техническая ошибка"),
  );
  const kk = screen.getByLabelText("Қазақша") as HTMLTextAreaElement;
  fireEvent.focus(kk);
  kk.setSelectionRange(0, 0);
  fireEvent.click(screen.getByText("Вставить"));
  expect(kk.value).toBe("{number}Қате");
  expect(screen.getByLabelText("Русский")).toHaveValue("Сбой");
});
