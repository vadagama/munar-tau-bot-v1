// Smoke-тесты защиты jobs (LLD-01 §2, LLD-04 §1):
// секрет не настроен в среде — 500; неверный/отсутствующий заголовок x-jobs-secret — 401;
// верный заголовок — 200, обработано 0 задач (VS-0); GET .../health — 200; прочий GET — 404.

import { assertRejects, assertEquals } from "@std/assert";

import { handle, JOBS_SECRET_ENV, telegramSendMessage } from "./index.ts";

const envWithSecret = (name: string) =>
  name === JOBS_SECRET_ENV ? "stub-secret" : undefined;
const envEmpty = () => undefined;

function post(headers: Record<string, string>): Request {
  return new Request("https://example.functions/jobs", {
    method: "POST",
    headers,
  });
}

Deno.test("секрет не настроен в среде — 500 INTERNAL", async () => {
  const response = await handle(post({}), envEmpty);
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, "INTERNAL");
});

Deno.test("заголовок отсутствует — 401", async () => {
  const response = await handle(post({}), envWithSecret);
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHENTICATED");
});

Deno.test("неверный заголовок — 401", async () => {
  const response = await handle(
    post({ "x-jobs-secret": "wrong" }),
    envWithSecret,
  );
  assertEquals(response.status, 401);
});

Deno.test("верный заголовок — 200, пустая очередь", async () => {
  const response = await handle(
    post({ "x-jobs-secret": "stub-secret" }),
    envWithSecret,
    {
      db: {
        query: () => Promise.resolve([]),
        transaction: (fn) =>
          fn({
            query: <T>(sql: string) =>
              Promise.resolve(
                (sql.includes("pg_try_advisory_xact_lock")
                  ? [{ acquired: true }]
                  : []) as T[],
              ),
          }),
        close: () => Promise.resolve(),
      },
      audit: {
        append: () => Promise.reject(new Error("unused")),
        list: () => Promise.reject(new Error("unused")),
      },
    },
    () => Promise.resolve(),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ok");
  assertEquals(body.processed, 0);
});

Deno.test("GET /health — 200 без секрета", async () => {
  const response = await handle(
    new Request("https://example.functions/jobs/health"),
    envEmpty,
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).service, "jobs");
});

Deno.test("GET без /health — 404 NOT_FOUND", async () => {
  const response = await handle(
    new Request("https://example.functions/jobs/queue"),
    envWithSecret,
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error.code, "NOT_FOUND");
});

Deno.test("занятый advisory lock завершает jobs без обработки очередей", async () => {
  let queries = 0;
  const response = await handle(
    post({ "x-jobs-secret": "stub-secret" }),
    envWithSecret,
    {
      db: {
        query: () => {
          throw new Error("Второй jobs не должен читать очередь");
        },
        transaction: (fn) =>
          fn({
            query: <T>() => {
              queries++;
              return Promise.resolve([{ acquired: false }] as T[]);
            },
          }),
        close: () => Promise.resolve(),
      },
      audit: {
        append: () => Promise.reject(new Error("unused")),
        list: () => Promise.reject(new Error("unused")),
      },
    },
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).busy, true);
  assertEquals(queries, 1);
});

function stubFetch(responses: { status: number; body: unknown }[]) {
  const calls: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return Promise.resolve(
      new Response(JSON.stringify(next.body), { status: next.status }),
    );
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

Deno.test("sendMessage уходит с HTML-разметкой и без превью ссылок", async () => {
  const stub = stubFetch([{ status: 200, body: { ok: true } }]);
  try {
    await telegramSendMessage("token", "123", "<b>З-26-1</b> готово");
    assertEquals(stub.calls.length, 1);
    assertEquals(stub.calls[0]!.parse_mode, "HTML");
    assertEquals(stub.calls[0]!.link_preview_options, { is_disabled: true });
  } finally {
    stub.restore();
  }
});

Deno.test("отказ разбора разметки (400) — повтор без parse_mode", async () => {
  const stub = stubFetch([
    { status: 400, body: { ok: false, description: "Bad Request: can't parse entities" } },
    { status: 200, body: { ok: true } },
  ]);
  try {
    await telegramSendMessage("token", "123", "текст со случайным <b>");
    assertEquals(stub.calls.length, 2);
    assertEquals(stub.calls[0]!.parse_mode, "HTML");
    assertEquals(stub.calls[1]!.parse_mode, undefined);
    assertEquals(stub.calls[1]!.text, "текст со случайным <b>");
  } finally {
    stub.restore();
  }
});

Deno.test("клавиатура уходит с первой попыткой (срез UX B)", async () => {
  const stub = stubFetch([{ status: 200, body: { ok: true } }]);
  try {
    const markup = { inline_keyboard: [[{ text: "Далее", callback_data: "/requests page:2" }]] };
    await telegramSendMessage("token", "123", "готово", markup);
    assertEquals(stub.calls.length, 1);
    assertEquals(stub.calls[0]!.reply_markup, markup);
    assertEquals(stub.calls[0]!.parse_mode, "HTML");
  } finally {
    stub.restore();
  }
});

Deno.test("отказ 400 с клавиатурой — повтор без parse_mode, но с клавиатурой, затем совсем без неё", async () => {
  const stub = stubFetch([
    { status: 400, body: { ok: false, description: "Bad Request: can't parse entities" } },
    { status: 400, body: { ok: false, description: "Bad Request" } },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const markup = { keyboard: [[{ text: "/tasks" }]], is_persistent: true };
    await telegramSendMessage("token", "123", "текст", markup);
    assertEquals(stub.calls.length, 3);
    assertEquals(stub.calls[0]!.parse_mode, "HTML");
    assertEquals(stub.calls[0]!.reply_markup, markup);
    assertEquals(stub.calls[1]!.parse_mode, undefined);
    assertEquals(stub.calls[1]!.reply_markup, markup);
    assertEquals(stub.calls[2]!.reply_markup, undefined);
    assertEquals(stub.calls[2]!.text, "текст");
  } finally {
    stub.restore();
  }
});

Deno.test("ошибка не-400 после fallback — выбрасывается для повторной попытки очереди", async () => {
  const stub = stubFetch([
    { status: 429, body: { ok: false, parameters: { retry_after: 3 } } },
  ]);
  try {
    await assertRejects(
      () => telegramSendMessage("token", "123", "текст"),
      Error,
      "TELEGRAM_429",
    );
  } finally {
    stub.restore();
  }
});
