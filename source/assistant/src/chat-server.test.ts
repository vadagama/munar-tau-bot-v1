// Тесты ChatServer: auth-хендшейк, submit с operationId, fan-out дельт,
// retry/resync, устаревшая эпоха. Рантайм и сокеты — фейки (S1.1: Pi за
// ChatRuntime не протекает, Workers API не используется).

import { beforeEach, describe, expect, it } from "vitest";
import { ChatServer, type ChatSocket } from "./chat-server.ts";
import type { AuthDecision } from "./protocol.ts";
import { encodeClientMessage } from "./protocol.ts";
import { FakeChatRuntime } from "./testing/fake-chat-runtime.ts";

class FakeSocket implements ChatSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  parsed(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }
}

interface Harness {
  server: ChatServer;
  runtime: FakeChatRuntime;
  setEpoch(state: "ok" | "stale"): void;
}

function makeServer(deps: Partial<{ decision: AuthDecision; epoch: "ok" | "stale" }> = {}): Harness {
  const runtime = new FakeChatRuntime();
  const decision: AuthDecision = deps.decision ?? { ok: true, profileId: "profile-1", epoch: 100 };
  let epochState: "ok" | "stale" = deps.epoch ?? "ok";
  const server = new ChatServer({
    runtime,
    authenticate: async () => decision,
    checkEpoch: async () => epochState,
    now: () => new Date("2026-10-26T06:00:00Z"),
  });
  return {
    server,
    runtime,
    setEpoch(state: "ok" | "stale") {
      epochState = state;
    },
  };
}

/** Подключает и аутентифицирует сокет, возвращает его. */
async function connect(server: ChatServer, jwt = "jwt-ok"): Promise<FakeSocket> {
  const socket = new FakeSocket();
  server.onOpen(socket);
  await server.onMessage(socket, encodeClientMessage({ type: "auth", jwt }), null);
  return socket;
}

describe("ChatServer — аутентификация", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeServer();
  });

  it("успешный auth отправляет auth_ok и снапшот", async () => {
    harness.runtime.messages.set("m1", { messageId: "m1", role: "user", text: "вопрос", status: "done" });
    const socket = await connect(harness.server);
    const parsed = socket.parsed();
    expect(parsed[0]).toMatchObject({ type: "auth_ok", profileId: "profile-1", epoch: 100 });
    expect(parsed[1]).toMatchObject({ type: "snapshot", messages: [{ messageId: "m1" }] });
    expect(socket.closed).toBeNull();
  });

  it("отказ гейта закрывает сокет с auth_error", async () => {
    const local = makeServer({ decision: { ok: false, reason: "Ассистент выключен" } });
    const socket = await connect(local.server, "jwt-bad");
    expect(socket.parsed()[0]).toMatchObject({ type: "auth_error", reason: "Ассистент выключен" });
    expect(socket.closed).not.toBeNull();
  });

  it("первое сообщение не auth — сокет закрывается", async () => {
    const socket = new FakeSocket();
    harness.server.onOpen(socket);
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), null);
    expect(socket.parsed()[0]).toMatchObject({ type: "auth_error" });
    expect(socket.closed).not.toBeNull();
  });

  it("нераспознанный формат — сокет закрывается", async () => {
    const socket = await connect(harness.server);
    await harness.server.onMessage(socket, "не json", { profileId: "profile-1", epoch: 100 });
    expect(socket.closed).not.toBeNull();
  });
});

describe("ChatServer — сообщения", () => {
  let harness: Harness;
  let socket: FakeSocket;

  beforeEach(async () => {
    harness = makeServer();
    socket = await connect(harness.server);
    socket.sent.length = 0;
  });

  it("submit передаёт messageId как operationId, ставит queued и завершается done", async () => {
    const pending = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-1", text: "кто что делает?" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-1");
    harness.runtime.finishReply("op-1", "полный ответ", { status: "done", text: "полный ответ" });
    await pending;
    expect(harness.runtime.submitted).toEqual([{ messageId: "op-1", text: "кто что делает?" }]);
    expect(socket.parsed()[0]).toMatchObject({ type: "status", messageId: "op-1", status: "queued" });
    expect(socket.parsed().at(-1)).toMatchObject({
      type: "done",
      messageId: "op-1",
      status: "done",
      text: "полный ответ",
    });
  });

  it("повтор того же messageId гасится идемпотентностью и возвращает текущий статус", async () => {
    const first = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-1", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-1");
    harness.runtime.startReply("op-1");
    harness.runtime.finishReply("op-1", "ответ", { status: "done", text: "ответ" });
    await first;

    harness.runtime.nextSubmitAccepted = false;
    await harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-1", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    expect(socket.parsed().at(-1)).toMatchObject({ type: "status", messageId: "op-1", status: "done" });
    // Транскрипт не вырос: дубликат не создал нового сообщения.
    expect(harness.runtime.messages.size).toBe(2); // вопрос + ответ ассистента
  });

  it("дельты рантайма рассылаются всем аутентифицированным сокетам", async () => {
    const second = await connect(harness.server);
    second.sent.length = 0;
    socket.sent.length = 0;

    harness.runtime.startReply("op-1");
    harness.runtime.emitDelta("op-1:reply", "частичный ");
    harness.runtime.emitDelta("op-1:reply", "ответ");

    expect(second.parsed()).toContainEqual({ type: "delta", messageId: "op-1:reply", text: "частичный " });
    expect(socket.parsed()).toContainEqual({ type: "delta", messageId: "op-1:reply", text: "ответ" });
  });

  it("апсет полной записи рассылается аутентифицированным сокетам", async () => {
    const second = await connect(harness.server);
    second.sent.length = 0;
    socket.sent.length = 0;

    harness.runtime.upsert({
      messageId: "pi-entry-1",
      role: "assistant",
      text: "полный ответ после обрыва",
      status: "done",
    });

    expect(socket.parsed()).toContainEqual({
      type: "upsert",
      message: { messageId: "pi-entry-1", role: "assistant", text: "полный ответ после обрыва", status: "done" },
    });
    expect(second.parsed()).toHaveLength(1);
  });

  it("сбой провайдера завершает операцию unanswered с причиной", async () => {
    const pending = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-3", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-3");
    harness.runtime.failRun("op-3", "провайдер недоступен");
    await pending;
    expect(socket.parsed().at(-1)).toMatchObject({
      type: "done",
      messageId: "op-3",
      status: "unanswered",
      error: "провайдер недоступен",
    });
  });

  it("retry вызывает runtime.retry", async () => {
    await harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "retry", messageId: "op-1" }),
      { profileId: "profile-1", epoch: 100 },
    );
    expect(harness.runtime.retried).toEqual(["op-1"]);
  });

  it("done передаёт пул источников из WaitResult, снапшот — из транскрипта", async () => {
    const sources = [{ title: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" }];
    const pending = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-s", text: "покажи новые обращения" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-s");
    harness.runtime.finishReply("op-s", "Вот обращения", { status: "done", text: "Вот обращения", sources });
    await pending;
    expect(socket.parsed().at(-1)).toMatchObject({ type: "done", messageId: "op-s", sources });

    harness.runtime.messages.set("r-1", {
      messageId: "r-1",
      role: "assistant",
      text: "снапшотный ответ",
      status: "done",
      sources,
    });
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), {
      profileId: "profile-1",
      epoch: 100,
    });
    const snapshot = socket.parsed().at(-1) as {
      type: string;
      messages: Array<{ messageId: string; sources?: unknown }>;
    };
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.messages.find((m) => m.messageId === "r-1")?.sources).toEqual(sources);
  });

  it("resync отправляет свежий снапшот", async () => {
    harness.runtime.messages.set("m1", { messageId: "m1", role: "user", text: "вопрос", status: "done" });
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), {
      profileId: "profile-1",
      epoch: 100,
    });
    expect(socket.parsed().at(-1)).toMatchObject({ type: "snapshot", messages: [{ messageId: "m1" }] });
  });

  it("устаревшая эпоха отклоняет сообщение и закрывает сокет", async () => {
    harness.setEpoch("stale");
    await harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-9", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    expect(harness.runtime.submitted).toHaveLength(0);
    expect(socket.parsed().at(-1)).toMatchObject({ type: "error", code: "epoch_stale" });
    expect(socket.closed).not.toBeNull();
  });
});
