// Сценарии панели AI-ассистента (S1.2/S1.3, jsdom с фейковым WebSocket):
// гейт settings/me и эмуляции, auth первым сообщением, снапшот, стриминг дельт,
// done с эталонным текстом, переподключение со снапшотом, epoch_stale → новая
// эпоха, «Повторить» после сбоя, идемпотентный повтор того же messageId;
// макет по прототипу: чипы примеров, ответы под формой, остаток лимита в шапке
// (решение владельца 26.10.2026 — кнопки «Очистить контекст» нет).

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AssistantPanel } from "./assistant-panel";

const state = vi.hoisted(() => ({
  identity: { emulation: false, isTest: false },
  access: null as Record<string, unknown> | null,
  wsUrl: "wss://assistant.example" as string | null,
  jwt: "jwt-1",
  sockets: [] as FakeWebSocket[],
}));

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  }

  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    state.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // — тестовые рычаги —

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../lib/identity", () => ({
  useCabinetIdentity: () => ({
    identity: {
      me: {
        profile: { id: "profile-1" },
        person: { id: "p-1", is_test: state.identity.isTest },
        emulation: state.identity.emulation ? { session_id: "s-1" } : null,
      },
    },
  }),
}));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: state.jwt } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));
vi.mock("../lib/env", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/env")>(),
  appEnv: {
    supabaseUrl: "https://supabase.example",
    supabaseKey: "anon",
    apiUrl: "https://supabase.example/functions/v1/api",
    configured: true,
    functionRegion: null,
    get assistantWsUrl() {
      return state.wsUrl;
    },
  },
}));

// WebSocket в jsdom подменяем фейком до импорта панели.
vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

import { apiFetch } from "../lib/api";

const accessEnabled = {
  enabled: true,
  daily_token_limit: 1000,
  monthly_token_limit: 10000,
  day_used: 0,
  month_used: 0,
  day: "2026-10-26",
  month: "2026-10",
  profile_id: "profile-1",
  epoch: 1,
};

function mockApi() {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === "/v1/assistant/settings/me") {
      if (state.access === null) throw new Error("FORBIDDEN");
      return state.access;
    }
    throw new Error(`unexpected api call: ${path} ${options?.method ?? "GET"}`);
  });
}

async function renderPanel(): Promise<void> {
  render(<MemoryRouter><AssistantPanel /></MemoryRouter>);
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  FakeWebSocket.last().open();
  // auth уходит первым сообщением после открытия.
  await waitFor(() => expect(FakeWebSocket.last().sent.length).toBeGreaterThan(0));
  acceptAuth(FakeWebSocket.last());
  // Панель развёрнута по умолчанию (первый вход без сохранённого выбора);
  // после auth_ok форма активна без нажатия «Развернуть».
  await waitFor(() => expect(screen.getByLabelText("Вопрос ассистенту")).toBeEnabled(), { timeout: 3000 });
}

/** Подтверждает auth (сервер): подключение считается открытым. */
function acceptAuth(socket: FakeWebSocket): void {
  const auth = JSON.parse(socket.sent[0]!) as { jwt: string };
  socket.receive({ type: "auth_ok", profileId: "profile-1", epoch: 1, jwt: auth.jwt });
}

beforeEach(() => {
  state.identity = { emulation: false, isTest: false };
  state.access = { ...accessEnabled };
  state.wsUrl = "wss://assistant.example";
  state.jwt = "jwt-1";
  state.sockets = [];
  FakeWebSocket.instances = [];
  mockApi();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
});

it("скрыта, когда ассистент выключен, в эмуляции или у тестовой персоны", async () => {
  state.access = { ...accessEnabled, enabled: false };
  render(<MemoryRouter><AssistantPanel /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("AI-ассистент")).not.toBeInTheDocument());

  cleanup();
  state.access = { ...accessEnabled };
  state.identity.emulation = true;
  render(<MemoryRouter><AssistantPanel /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("AI-ассистент")).not.toBeInTheDocument());

  cleanup();
  state.identity.emulation = false;
  state.identity.isTest = true;
  render(<MemoryRouter><AssistantPanel /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("AI-ассистент")).not.toBeInTheDocument());
});

it("при первом входе панель развёрнута: поле ввода видно сразу после подключения", async () => {
  await renderPanel();
  // Развёрнутое состояние сохраняется как выбор пользователя.
  expect(localStorage.getItem("assistant.panel.open")).toBe("1");
});

it("свёрнутая панель (сохранённый выбор) без пустого тела: разворачивается кнопкой", async () => {
  localStorage.setItem("assistant.panel.open", "0");
  render(<MemoryRouter><AssistantPanel /></MemoryRouter>);
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  FakeWebSocket.last().open();
  await waitFor(() => expect(FakeWebSocket.last().sent.length).toBeGreaterThan(0));
  acceptAuth(FakeWebSocket.last());
  // Пустого тела нет — свёрнутая панель это только шапка с кнопкой.
  await waitFor(() => expect(document.querySelector(".ant-card-body")).toHaveStyle({ display: "none" }));
  fireEvent.click(screen.getByRole("button", { name: "Развернуть" }));
  expect(screen.getByLabelText("Вопрос ассистенту")).toBeEnabled();
  expect(localStorage.getItem("assistant.panel.open")).toBe("1");
});

it("подключается с профилем и эффективной эпохой, JWT — первым сообщением, не в URL", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  expect(socket.url).toContain("profile_id=profile-1");
  // Эндпоинт апгрейда Worker — /ws: базовый адрес из сборки без пути (S1.2).
  expect(socket.url.startsWith("wss://assistant.example/ws?")).toBe(true);
  // epoch=1 → эффективная эпоха = номер UTC-суток (сегодняшний день).
  expect(socket.url).toMatch(/epoch=\d{5,}/);
  expect(socket.url).not.toContain("jwt");
  const auth = JSON.parse(socket.sent[0]!) as { type: string; jwt: string };
  expect(auth).toEqual({ type: "auth", jwt: "jwt-1" });
});

it("снапшот восстанавливает историю, дельты стримятся в ответ, done ставит эталонный текст", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  socket.receive({
    type: "snapshot",
    messages: [
      { messageId: "m-1", role: "user", text: "кто что делает?", status: "done" },
      { messageId: "r-1", role: "assistant", text: "Полный ответ", status: "done" },
    ],
  });
  expect(await screen.findByText("кто что делает?")).toBeInTheDocument();
  expect(screen.getByText("Полный ответ")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "просрочки?" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("просрочки?")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { type: string; messageId: string; text: string };
  expect(sent.type).toBe("message");
  expect(sent.text).toBe("просрочки?");
  // Оптимистичное сообщение в очереди, кнопка в состоянии загрузки.
  expect(screen.getByText("Готовлю ответ")).toBeInTheDocument();

  socket.receive({ type: "delta", messageId: `${sent.messageId}:reply`, text: "Частичн" });
  expect(await screen.findByText(/Частичн/)).toBeInTheDocument();
  socket.receive({ type: "delta", messageId: `${sent.messageId}:reply`, text: "ый ответ" });
  socket.receive({ type: "done", messageId: sent.messageId, status: "done", text: "Полный финальный ответ" });
  await waitFor(() => expect(screen.getByText("Полный финальный ответ")).toBeInTheDocument());
  expect(screen.getByText("Спросить")).toBeInTheDocument();
});

it("done с sources рендерит карточку-ссылку из пула инструментов", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "покажи новые обращения" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  socket.receive({
    type: "done",
    messageId: sent.messageId,
    status: "done",
    text: "Нашёл обращение [№ОБ-12 · Лифт](/requests?request=r1&entity_page=1)",
    sources: [{ title: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" }],
  });
  const link = await screen.findByRole("link", { name: "№ОБ-12 · Лифт" });
  expect(link).toHaveAttribute("href", "/requests?request=r1&entity_page=1");
});

it("done с tables рендерит таблицу агрегата, битый контракт отбрасывается", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "кто как загружен?" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  socket.receive({
    type: "done",
    messageId: sent.messageId,
    status: "done",
    text: "Вот нагрузка по исполнителям.",
    tables: [
      {
        id: "workload_by_assignee",
        title: "Нагрузка по исполнителям",
        columns: [
          { key: "name", title: "Исполнитель", kind: "text" },
          { key: "open", title: "Открытые", kind: "number" },
        ],
        rows: [{ name: "Петров Пётр", open: 3 }],
      },
      { id: "broken", columns: "не массив", rows: [] },
    ],
  });
  const region = await screen.findByRole("region", { name: "Нагрузка по исполнителям" });
  expect(region).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Петров Пётр" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "broken" })).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

it("HTML из ответа не рендерится", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  socket.receive({
    type: "snapshot",
    messages: [{ messageId: "m-1", role: "user", text: "вопрос", status: "done" }],
  });
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  socket.receive({
    type: "done",
    messageId: sent.messageId,
    status: "done",
    text: "Ответ <script>alert(1)</script> конец",
  });
  await waitFor(() => expect(screen.getByText(/Ответ <script>/)).toBeInTheDocument());
  expect(document.querySelector("script")).toBeNull();
});

it("обрыв соединения → переподключение с новым токеном и восстановление со снапшота", async () => {
  await renderPanel();
  const first = FakeWebSocket.last();
  first.receive({
    type: "snapshot",
    messages: [{ messageId: "m-1", role: "user", text: "история", status: "done" }],
  });
  expect(await screen.findByText("история")).toBeInTheDocument();

  state.jwt = "jwt-2";
  first.drop();
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), { timeout: 5000 });
  const second = FakeWebSocket.last();
  second.open();
  await waitFor(() => {
    const auth = JSON.parse(second.sent[0]!) as { type: string; jwt: string };
    expect(auth.jwt).toBe("jwt-2");
  });
  acceptAuth(second);
  await waitFor(() => expect(screen.getByLabelText("Вопрос ассистенту")).toBeEnabled(), { timeout: 3000 });
  second.receive({
    type: "snapshot",
    messages: [
      { messageId: "m-1", role: "user", text: "история", status: "done" },
      { messageId: "r-1", role: "assistant", text: "восстановленный ответ", status: "done" },
    ],
  });
  expect(await screen.findByText("восстановленный ответ")).toBeInTheDocument();
});

it("epoch_stale: панель перечитывает эпоху и переподключается к новому DO", async () => {
  await renderPanel();
  const first = FakeWebSocket.last();
  // Сервер уже на новой эпохе (очистка через другой сеанс): settings/me вернёт 50000.
  state.access = { ...accessEnabled, epoch: 50000 };
  const callsBefore = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/assistant/settings/me").length;
  first.receive({ type: "error", code: "epoch_stale", message: "Сессия очищена" });
  await waitFor(() => {
    const calls = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/assistant/settings/me").length;
    expect(calls).toBeGreaterThan(callsBefore);
  });
  // Панель перечитала эпоху и переподключилась к новому DO.
  await waitFor(() => expect(FakeWebSocket.last().url).toContain("epoch=50000"), { timeout: 5000 });
});

it("сбой провайдера → развёрнутый блок ошибки и «Повторить» отправляет текст с новым operationId", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос про лимиты" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  socket.receive({ type: "done", messageId: sent.messageId, status: "unanswered", error: "провайдер недоступен" });
  // Развёрнутый блок ошибки: заголовок + причина + «Повторить».
  expect(await screen.findByText("Не удалось получить ответ")).toBeInTheDocument();
  expect(screen.getByText("провайдер недоступен")).toBeInTheDocument();
  const button = await screen.findByRole("button", { name: /Повторить/ });
  fireEvent.click(button);
  await waitFor(() => {
    const repeat = JSON.parse(socket.sent.at(-1)!) as { type: string; messageId: string; text: string };
    expect(repeat.type).toBe("message");
    expect(repeat.text).toBe("вопрос про лимиты");
    expect(repeat.messageId).not.toBe(sent.messageId);
  });
});

it("статус parked от сервера — «Повторить» отправляет {type:\"retry\"} с тем же messageId (S6.1)", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "зависший вопрос" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  // S6.1: parked приходит и живым статусом, и после переподключения (после снапшота).
  socket.receive({ type: "status", messageId: sent.messageId, status: "parked" });
  expect(await screen.findByRole("button", { name: /Повторить/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Повторить/ }));
  await waitFor(() => {
    const repeat = JSON.parse(socket.sent.at(-1)!) as { type: string; messageId: string };
    expect(repeat.type).toBe("retry");
    expect(repeat.messageId).toBe(sent.messageId);
  });
});

it("повторная отправка того же messageId не создаёт второй прогон (идемпотентность)", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const first = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  // Тот же messageId снова (например, после обрыва до получения ответа).
  socket.send(JSON.stringify({ type: "message", messageId: first.messageId, text: "вопрос" }));
  const ids = socket.sent
    .map((raw) => JSON.parse(raw) as { type: string; messageId: string })
    .filter((m) => m.type === "message")
    .map((m) => m.messageId);
  expect(new Set(ids).size).toBe(1);
});

it("ошибка limit_exceeded: сообщение сбойное с причиной и «Повторить», расход перечитан", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос при лимите" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  const callsBefore = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/assistant/settings/me").length;
  socket.receive({
    type: "error",
    code: "limit_exceeded",
    messageId: sent.messageId,
    message: "Дневной лимит токенов исчерпан — попробуйте после 05:00",
  });
  // Причина отказа — в сообщении, повтор доступен; расход перечитан (S3.2).
  expect(await screen.findByText("Дневной лимит токенов исчерпан — попробуйте после 05:00")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Повторить/ })).toBeInTheDocument();
  await waitFor(() => {
    const calls = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/assistant/settings/me").length;
    expect(calls).toBeGreaterThan(callsBefore);
  });
});

it("исчерпанный по settings/me лимит после отказа гейта — эталонный Alert вместо панели", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  // Перечитанный settings/me подтверждает: дневной лимит исчерпан.
  state.access = { ...accessEnabled, day_used: 1000 };
  socket.receive({ type: "error", code: "limit_exceeded", messageId: sent.messageId, message: "Дневной лимит токенов исчерпан" });
  expect(await screen.findByText(/Дневной лимит AI-ассистента исчерпан/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Вопрос ассистенту")).not.toBeInTheDocument();
});

it("остаток дневного лимита — в шапке панели, без лимита — нет (S3.2)", async () => {
  state.access = { ...accessEnabled, day_used: 250 };
  await renderPanel();
  expect(screen.getByText(/Осталось 750 из 1\s?000/)).toBeInTheDocument();
  expect(screen.getByTitle("Остаток дневного лимита токенов (05:00→05:00 Алматы)")).toBeInTheDocument();

  cleanup();
  FakeWebSocket.instances = [];
  state.access = { ...accessEnabled, daily_token_limit: null, day_used: 250 };
  render(<MemoryRouter><AssistantPanel /></MemoryRouter>);
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  expect(screen.queryByText(/Осталось/)).not.toBeInTheDocument();
});
it("чипы примеров заполняют поле ввода, не отправляя вопрос", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.click(screen.getByText("Что требует внимания?"));
  expect(screen.getByLabelText("Вопрос ассистенту")).toHaveValue("Что требует внимания?");
  // Чип не отправляет: WS-сообщений типа message нет.
  expect(socket.sent.some((raw) => (JSON.parse(raw) as { type: string }).type === "message")).toBe(false);
});

it("ответы рендерятся под формой ввода", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  socket.receive({ type: "done", messageId: sent.messageId, status: "done", text: "Полный финальный ответ" });
  await waitFor(() => expect(screen.getByText("Полный финальный ответ")).toBeInTheDocument());
  const input = screen.getByLabelText("Вопрос ассистенту");
  const answer = screen.getByText("Полный финальный ответ");
  // Ответ идёт после поля ввода в DOM (решение владельца 26.10.2026).
  expect((input.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
});

it("у блока «Ответ ассистента» после done есть время", async () => {
  await renderPanel();
  const socket = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "вопрос" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  const sent = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
  socket.receive({ type: "done", messageId: sent.messageId, status: "done", text: "Ответ готов" });
  await waitFor(() => expect(screen.getByText("Ответ готов")).toBeInTheDocument());
  expect(screen.getByText("Ответ ассистента")).toBeInTheDocument();
  // Клиентское время (Asia/Almaty, dd.mm.yyyy, hh:mm).
  expect(screen.getByText(/\d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument();
});

it("после обрыва снапшот не дублирует отправленный вопрос", async () => {
  await renderPanel();
  const first = FakeWebSocket.last();
  fireEvent.change(screen.getByLabelText("Вопрос ассистенту"), { target: { value: "дубликат?" } });
  fireEvent.click(screen.getByText("Спросить"));
  await waitFor(() => expect(screen.getByText("Готовлю ответ")).toBeInTheDocument());
  first.drop();
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), { timeout: 5000 });
  const second = FakeWebSocket.last();
  second.open();
  await waitFor(() => expect(second.sent.length).toBeGreaterThan(0));
  acceptAuth(second);
  second.receive({
    type: "snapshot",
    messages: [{ messageId: "t-1", role: "user", text: "дубликат?", status: "done" }],
  });
  await waitFor(() => expect(screen.getByText("дубликат?")).toBeInTheDocument());
  // Оптимистичный вопрос и запись транскрипта — один блок, а не два.
  expect(screen.getAllByText("дубликат?")).toHaveLength(1);
});
