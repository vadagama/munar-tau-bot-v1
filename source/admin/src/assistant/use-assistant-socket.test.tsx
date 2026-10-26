// Watchdog busy-тишины (регрессия: вечный спиннер 26.10.2026): пока панель
// busy (queued/running) и от сервера нет трафика дольше BUSY_RESYNC_AFTER_MS,
// хук сам просит resync — потерянный done восстанавливается без F5.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantSocket } from "./use-assistant-socket";

const state = vi.hoisted(() => ({
  access: null as Record<string, unknown> | null,
  wsUrl: "wss://assistant.example" as string | null,
  jwt: "jwt-1",
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
        person: { id: "p-1", is_test: false },
        emulation: null,
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
vi.mock("../lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/env")>()),
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

// WebSocket в jsdom подменяем фейком до импорта хука.
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

/** Подключает и аутентифицирует сокет хука (как сервер). */
async function connectSocket(): Promise<FakeWebSocket> {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  const socket = FakeWebSocket.last();
  await act(async () => {
    socket.open();
  });
  await act(async () => {
    socket.receive({ type: "auth_ok", profileId: "profile-1", epoch: 1 });
  });
  return socket;
}

function sentTypes(socket: FakeWebSocket): string[] {
  return socket.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
}

function resyncCount(socket: FakeWebSocket): number {
  return sentTypes(socket).filter((type) => type === "resync").length;
}

beforeEach(() => {
  vi.useFakeTimers();
  state.access = { ...accessEnabled };
  state.wsUrl = "wss://assistant.example";
  state.jwt = "jwt-1";
  FakeWebSocket.instances = [];
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === "/v1/assistant/settings/me") {
      if (state.access === null) throw new Error("FORBIDDEN");
      return state.access;
    }
    throw new Error(`unexpected api call: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
});

describe("useAssistantSocket — watchdog resync при busy-тишине", () => {
  it("busy и тишина 60 с → хук отправляет resync", async () => {
    const { result } = renderHook(() => useAssistantSocket());
    const socket = await connectSocket();
    await act(async () => {
      expect(result.current.send("вопрос")).toBe(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(sentTypes(socket).at(-1)).toBe("resync");
  });

  it("входящий трафик сбрасывает окно тишины: resync через 45 с после последнего сообщения сервера", async () => {
    const { result } = renderHook(() => useAssistantSocket());
    const socket = await connectSocket();
    await act(async () => {
      expect(result.current.send("вопрос")).toBe(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {
      socket.receive({ type: "delta", messageId: "op-1:reply", text: "часть" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // 30 с после дельты — окна тишины ещё не хватает.
    expect(resyncCount(socket)).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(resyncCount(socket)).toBe(1);
  });

  it("без незавершённых сообщений resync не отправляется", async () => {
    renderHook(() => useAssistantSocket());
    const socket = await connectSocket();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(resyncCount(socket)).toBe(0);
  });
});
