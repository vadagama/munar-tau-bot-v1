// Тесты ChatServer: auth-хендшейк, submit с operationId, fan-out дельт,
// retry/resync, устаревшая эпоха. Рантайм и сокеты — фейки (S1.1: Pi за
// ChatRuntime не протекает, Workers API не используется).

import { beforeEach, describe, expect, it } from "vitest";
import { ChatServer, type ChatServerDeps, type ChatSocket } from "./chat-server.ts";
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
  acceptedJwts: string[];
  setEpoch(state: "ok" | "stale"): void;
  setLimits(state: "ok" | "day" | "month"): void;
  usageReports: Array<{ operationId: string; promptTokens: number; completionTokens: number }>;
  /** Ждёт завершения фоновых вейтеров done, переданных в defer (как ctx.waitUntil в DO). */
  settle(): Promise<void>;
}

function makeServer(
  deps: Partial<{
    decision: AuthDecision;
    epoch: "ok" | "stale";
    limits: "ok" | "day" | "month";
    runtime: FakeChatRuntime;
    onUsage: ChatServerDeps["onUsage"];
  }> = {},
): Harness {
  const runtime = deps.runtime ?? new FakeChatRuntime();
  const decision: AuthDecision = deps.decision ?? { ok: true, profileId: "profile-1", epoch: 100 };
  let epochState: "ok" | "stale" = deps.epoch ?? "ok";
  let limitsState: "ok" | "day" | "month" = deps.limits ?? "ok";
  const usageReports: Array<{ operationId: string; promptTokens: number; completionTokens: number }> = [];
  const acceptedJwts: string[] = [];
  const deferred: Promise<void>[] = [];
  const server = new ChatServer({
    runtime,
    // Как обвязка DO (do.ts): JWT запоминается только после успешного гейта —
    // это сеанс изолята для runtime-token и инструментов.
    authenticate: async (jwt) => {
      if (decision.ok) acceptedJwts.push(jwt);
      return decision;
    },
    checkEpoch: async () => epochState,
    checkLimits: async () => limitsState,
    onUsage: deps.onUsage ?? ((operationId, usage) => {
      usageReports.push({ operationId, ...usage });
    }),
    // Как обвязка DO: фоновые вейтеры живут вне обработчика WS-сообщения.
    defer: (promise) => {
      deferred.push(promise);
    },
    now: () => new Date("2026-10-26T06:00:00Z"),
  });
  return {
    server,
    runtime,
    acceptedJwts,
    setEpoch(state: "ok" | "stale") {
      epochState = state;
    },
    setLimits(state: "ok" | "day" | "month") {
      limitsState = state;
    },
    usageReports,
    settle: async () => {
      await Promise.allSettled([...deferred]);
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

  it("JWT запоминается для изолята только при успехе гейта (регрессия: accessToken не присваивался)", async () => {
    await connect(harness.server, "jwt-good");
    expect(harness.acceptedJwts).toEqual(["jwt-good"]);
    const local = makeServer({ decision: { ok: false, reason: "нет" } });
    await connect(local.server, "jwt-bad");
    expect(local.acceptedJwts).toEqual([]);
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

  it("после снапшота уходят статусы незавершённых операций — parked виден после переподключения", async () => {
    // foldEntry помечает пользовательские записи «done», поэтому единственный
    // источник живого статуса — runtime.pending() (S6.1).
    harness.runtime.messages.set("p1", { messageId: "p1", role: "user", text: "зависший вопрос", status: "parked" });
    harness.runtime.messages.set("p2", { messageId: "p2", role: "user", text: "очередной вопрос", status: "queued" });
    const socket = new FakeSocket();
    harness.server.onOpen(socket);
    await harness.server.onMessage(socket, encodeClientMessage({ type: "auth", jwt: "jwt-ok" }), null);
    const parsed = socket.parsed();
    const snapshotIndex = parsed.findIndex((m) => (m as { type: string }).type === "snapshot");
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(parsed.slice(snapshotIndex + 1)).toEqual([
      { type: "status", messageId: "p1", status: "parked" },
      { type: "status", messageId: "p2", status: "queued" },
    ]);
  });

  it("устаревшая эпоха на хендшейке — auth_ok и старый снапшот не отправляются, сокет закрывается с epoch_stale", async () => {
    // DO прошлой эпохи (после «Очистить» или границы суток 05:00) не имеет права
    // отдавать историю даже с валидным JWT того же профиля (S6.1).
    const local = makeServer({ epoch: "stale" });
    local.runtime.messages.set("m1", { messageId: "m1", role: "user", text: "старый вопрос", status: "done" });
    const socket = new FakeSocket();
    local.server.onOpen(socket);
    await local.server.onMessage(socket, encodeClientMessage({ type: "auth", jwt: "jwt-ok" }), null);
    expect(socket.parsed()).not.toContainEqual(expect.objectContaining({ type: "auth_ok" }));
    expect(socket.parsed()).not.toContainEqual(expect.objectContaining({ type: "snapshot" }));
    expect(socket.parsed().at(-1)).toMatchObject({ type: "error", code: "epoch_stale" });
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
    await harness.settle();
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
    await harness.settle();

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
    await harness.settle();
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

  it("done передаёт пул источников и таблицы агрегатов из WaitResult, снапшот — из транскрипта", async () => {
    const sources = [{ title: "№ОБ-12 · Лифт", href: "/requests?request=r1&entity_page=1" }];
    const tables = [{
      id: "workload_by_assignee",
      title: "Нагрузка по исполнителям",
      columns: [
        { key: "name", title: "Исполнитель", kind: "text" as const },
        { key: "open", title: "Открытые", kind: "number" as const },
      ],
      rows: [{ name: "Петров Пётр", open: 3 }],
    }];
    const pending = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-s", text: "кто как загружен?" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-s");
    harness.runtime.finishReply("op-s", "Вот нагрузка", { status: "done", text: "Вот нагрузка", sources, tables });
    await pending;
    await harness.settle();
    expect(socket.parsed().at(-1)).toMatchObject({ type: "done", messageId: "op-s", sources, tables });

    harness.runtime.messages.set("r-1", {
      messageId: "r-1",
      role: "assistant",
      text: "снапшотный ответ",
      status: "done",
      sources,
      tables,
    });
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), {
      profileId: "profile-1",
      epoch: 100,
    });
    const snapshot = socket.parsed().at(-1) as {
      type: string;
      messages: Array<{ messageId: string; sources?: unknown; tables?: unknown }>;
    };
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.messages.find((m) => m.messageId === "r-1")?.sources).toEqual(sources);
    expect(snapshot.messages.find((m) => m.messageId === "r-1")?.tables).toEqual(tables);
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

describe("ChatServer — гейт лимитов и учёт расхода (S3.1)", () => {
  let harness: Harness;
  let socket: FakeSocket;

  beforeEach(async () => {
    harness = makeServer();
    socket = await connect(harness.server);
    socket.sent.length = 0;
  });

  it("исчерпанный дневной лимит — отказ limit_exceeded до submit, модель не вызывается", async () => {
    harness.setLimits("day");
    await harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-l1", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    expect(harness.runtime.submitted).toHaveLength(0);
    expect(harness.usageReports).toHaveLength(0);
    expect(socket.parsed().at(-1)).toMatchObject({
      type: "error",
      code: "limit_exceeded",
      messageId: "op-l1",
    });
    expect(socket.closed).toBeNull();
  });

  it("исчерпанный месячный лимит — отказ limit_exceeded до submit", async () => {
    harness.setLimits("month");
    await harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-l2", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    expect(harness.runtime.submitted).toHaveLength(0);
    expect(socket.parsed().at(-1)).toMatchObject({ type: "error", code: "limit_exceeded" });
  });

  it("после ответа расход операции уходит в onUsage (идемпотентность — на стороне POST)", async () => {
    harness.runtime.usageByOperation.set("op-u1", { promptTokens: 120, completionTokens: 30 });
    const pending = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-u1", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-u1");
    harness.runtime.finishReply("op-u1", "ответ", { status: "done", text: "ответ" });
    await pending;
    await harness.settle();
    expect(harness.usageReports).toEqual([
      { operationId: "op-u1", promptTokens: 120, completionTokens: 30 },
    ]);
    // done ушёл независимо от учёта.
    expect(socket.parsed().at(-1)).toMatchObject({ type: "done", messageId: "op-u1", status: "done" });
  });

  it("без ответа модели (unanswered) учёт расхода не вызывается", async () => {
    const pending = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-u2", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-u2");
    harness.runtime.usageByOperation.set("op-u2", { promptTokens: 10, completionTokens: 5 });
    harness.runtime.failRun("op-u2", "провайдер недоступен");
    await pending;
    await harness.settle();
    expect(harness.usageReports).toHaveLength(0);
  });

  it("ошибка onUsage не ломает done", async () => {
    const local = makeServer({
      onUsage: () => {
        throw new Error("POST упал");
      },
    });
    const sock = await connect(local.server);
    sock.sent.length = 0;
    local.runtime.usageByOperation.set("op-u3", { promptTokens: 1, completionTokens: 1 });
    const pending = local.server.onMessage(
      sock,
      encodeClientMessage({ type: "message", messageId: "op-u3", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await local.runtime.untilAwaited("op-u3");
    local.runtime.finishReply("op-u3", "ответ", { status: "done", text: "ответ" });
    await pending;
    await local.settle();
    expect(sock.parsed().at(-1)).toMatchObject({ type: "done", messageId: "op-u3", status: "done" });
  });
});

describe("ChatServer — доставка done при потере сокета/изолята (регрессия: вечный спиннер)", () => {
  it("done доходит сокету, подключившемуся после submit, пока операция была незавершённой", async () => {
    // Инцидент 26.10.2026: вейтер done жил в обработчике WS-сообщения и умирал
    // вместе с сокетом/изолятом — панель оставалась в busy навсегда.
    const harness = makeServer();
    const first = new FakeSocket();
    harness.server.onOpen(first);
    await harness.server.onMessage(first, encodeClientMessage({ type: "auth", jwt: "jwt-ok" }), null);
    const submitted = harness.server.onMessage(
      first,
      encodeClientMessage({ type: "message", messageId: "op-1", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-1");
    // Клиент потерял сокет (сеть) — сервер снимает его с рассылки.
    harness.server.onClose(first);
    const second = await connect(harness.server);
    harness.runtime.finishReply("op-1", "полный ответ", { status: "done", text: "полный ответ" });
    await submitted;
    await harness.settle();
    expect(second.parsed()).toContainEqual({
      type: "done",
      messageId: "op-1",
      status: "done",
      text: "полный ответ",
    });
  });

  it("после рестарта изолята (новый ChatServer на том же рантайме) хендшейк переподписывается на незавершённую операцию", async () => {
    const runtime = new FakeChatRuntime();
    const before = makeServer({ runtime });
    const sockA = new FakeSocket();
    before.server.onOpen(sockA);
    await before.server.onMessage(sockA, encodeClientMessage({ type: "auth", jwt: "jwt-ok" }), null);
    const submitted = before.server.onMessage(
      sockA,
      encodeClientMessage({ type: "message", messageId: "op-9", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await runtime.untilAwaited("op-9");
    // Изолят вытеснен вместе с вейтером: новый ChatServer на том же хранилище.
    const after = makeServer({ runtime });
    const sockB = await connect(after.server);
    runtime.finishReply("op-9", "ответ после рестарта", { status: "done", text: "ответ после рестарта" });
    await submitted;
    await after.settle();
    expect(sockB.parsed()).toContainEqual({
      type: "done",
      messageId: "op-9",
      status: "done",
      text: "ответ после рестарта",
    });
  });

  it("done рассылается всем аутентифицированным сокетам (несколько вкладок)", async () => {
    const harness = makeServer();
    const a = await connect(harness.server);
    const b = await connect(harness.server);
    const submitted = harness.server.onMessage(
      a,
      encodeClientMessage({ type: "message", messageId: "op-2", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-2");
    harness.runtime.finishReply("op-2", "ответ", { status: "done", text: "ответ" });
    await submitted;
    await harness.settle();
    const done = { type: "done", messageId: "op-2", status: "done", text: "ответ" };
    expect(a.parsed()).toContainEqual(done);
    expect(b.parsed()).toContainEqual(done);
  });

  it("повторный resync не создаёт дубликата done", async () => {
    const harness = makeServer();
    const socket = await connect(harness.server);
    const submitted = harness.server.onMessage(
      socket,
      encodeClientMessage({ type: "message", messageId: "op-4", text: "вопрос" }),
      { profileId: "profile-1", epoch: 100 },
    );
    await harness.runtime.untilAwaited("op-4");
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), { profileId: "profile-1", epoch: 100 });
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), { profileId: "profile-1", epoch: 100 });
    harness.runtime.finishReply("op-4", "ответ", { status: "done", text: "ответ" });
    await submitted;
    await harness.settle();
    const dones = socket.parsed().filter((m) => (m as { type: string }).type === "done");
    expect(dones).toHaveLength(1);
  });

  it("запаркованная операция не держит вейтер, после «Повторить» — держит", async () => {
    // Вечный вейтер на parked держал бы DO живым и ждал бы ручного действия.
    const harness = makeServer();
    const socket = await connect(harness.server);
    harness.runtime.messages.set("p1", { messageId: "p1", role: "user", text: "завис", status: "parked" });
    await harness.server.onMessage(socket, encodeClientMessage({ type: "resync" }), { profileId: "profile-1", epoch: 100 });
    expect(harness.runtime.awaited).not.toContain("p1");
    await harness.server.onMessage(socket, encodeClientMessage({ type: "retry", messageId: "p1" }), { profileId: "profile-1", epoch: 100 });
    expect(harness.runtime.awaited).toContain("p1");
  });
});
