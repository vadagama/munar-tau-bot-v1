// Smoke-тесты защиты jobs (LLD-01 §2, LLD-04 §1):
// секрет не настроен в среде — 500; неверный/отсутствующий заголовок x-jobs-secret — 401;
// верный заголовок — 200, обработано 0 задач (VS-0); GET .../health — 200; прочий GET — 404.

import { assertEquals } from "@std/assert";

import { JOBS_SECRET_ENV, handle } from "./index.ts";

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
    { db: {query:()=>Promise.resolve([]),transaction:fn=>fn({query:()=>Promise.resolve([])}),close:()=>Promise.resolve()}, audit:{append:()=>Promise.reject(new Error("unused")),list:()=>Promise.reject(new Error("unused"))} },
    ()=>Promise.resolve(),
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
