// Smoke-тесты защиты bot-webhook (LLD-03 §6):
// без секрета в среде — 500; неверный/отсутствующий заголовок — 401 (тело не читается);
// верный заголовок — 200 accepted; GET .../health — 200.

import { assertEquals } from "@std/assert";

import { WEBHOOK_SECRET_ENV, handle } from "./index.ts";

const envWithSecret = (name: string) =>
  name === WEBHOOK_SECRET_ENV ? "stub-secret" : undefined;
const envEmpty = () => undefined;

function post(headers: Record<string, string>): Request {
  return new Request("https://example.functions/bot-webhook", {
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
    post({ "X-Telegram-Bot-Api-Secret-Token": "wrong" }),
    envWithSecret,
  );
  assertEquals(response.status, 401);
});

Deno.test("верный заголовок — 200 accepted, handled=false (VS-0)", async () => {
  const response = await handle(
    post({ "X-Telegram-Bot-Api-Secret-Token": "stub-secret" }),
    envWithSecret,
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.ok, true);
  assertEquals(body.handled, false);
});

Deno.test("GET /health — 200 без секрета", async () => {
  const response = await handle(
    new Request("https://example.functions/bot-webhook/health"),
    envEmpty,
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).service, "bot-webhook");
});
