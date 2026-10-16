// Smoke-тесты заглушки api: health без аутентификации, остальные маршруты —
// 401 UNAUTHENTICATED в формате ошибок LLD-03 §1.1.

import { assertEquals } from "@std/assert";

import { handle } from "./index.ts";

const env = () => undefined;

Deno.test("GET /v1/meta/health — 200 без аутентификации", async () => {
  const response = await handle(
    new Request("https://example.functions/v1/meta/health"),
    env,
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ok");
  assertEquals(body.service, "api");
});

Deno.test("неизвестный маршрут — 401 UNAUTHENTICATED с trace_id", async () => {
  const response = await handle(
    new Request("https://example.functions/v1/requests"),
    env,
  );
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(typeof body.error.trace_id, "string");
});

Deno.test("POST на health — 401 (только GET)", async () => {
  const response = await handle(
    new Request("https://example.functions/v1/meta/health", { method: "POST" }),
    env,
  );
  assertEquals(response.status, 401);
});
