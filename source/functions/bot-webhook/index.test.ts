// Smoke-тесты защиты bot-webhook (LLD-03 §6, ADR-009):
// без секрета в среде — 500; неверный/отсутствующий заголовок — 401 (тело не читается);
// верный заголовок — 200 accepted; секрет каждого бота — своя переменная среды;
// неизвестный суффикс пути — 404; GET .../health — 200.

import { assertEquals } from "@std/assert";
import { WORKER_WEBHOOK_SECRET_ENV } from "../../core/src/bot/bots.ts";
import { WEBHOOK_SECRET_ENV, handle } from "./index.ts";

const RESIDENT_SECRET = "stub-secret";
const WORKER_SECRET = "worker-stub-secret";
const envWithSecret = (name: string) =>
  name === WEBHOOK_SECRET_ENV ? RESIDENT_SECRET
  : name === WORKER_WEBHOOK_SECRET_ENV ? WORKER_SECRET
  : undefined;
const envEmpty = () => undefined;

function post(headers: Record<string, string>, path = "/bot-webhook"): Request {
  return new Request(`https://example.functions${path}`, {
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

Deno.test("верный заголовок с пустым телом — 400, update обязателен", async () => {
  const response = await handle(
    post({ "X-Telegram-Bot-Api-Secret-Token": "stub-secret" }),
    envWithSecret,
  );
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "VALIDATION_FAILED");
});

Deno.test("worker: верный секрет сотруднического бота с пустым телом — 400", async () => {
  const response = await handle(
    post(
      { "X-Telegram-Bot-Api-Secret-Token": WORKER_SECRET },
      "/bot-webhook/worker",
    ),
    envWithSecret,
  );
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "VALIDATION_FAILED");
});

Deno.test("worker: секрет бота жителей не подходит — 401", async () => {
  const response = await handle(
    post(
      { "X-Telegram-Bot-Api-Secret-Token": RESIDENT_SECRET },
      "/bot-webhook/worker",
    ),
    envWithSecret,
  );
  assertEquals(response.status, 401);
});

Deno.test("неизвестный суффикс пути — 404", async () => {
  const response = await handle(
    post({ "X-Telegram-Bot-Api-Secret-Token": RESIDENT_SECRET }, "/bot-webhook/other"),
    envWithSecret,
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error.code, "NOT_FOUND");
});

Deno.test("GET /health — 200 без секрета", async () => {
  const response = await handle(
    new Request("https://example.functions/bot-webhook/health"),
    envEmpty,
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).service, "bot-webhook");
});

Deno.test("диагностика сбоя не перезаписывает уже processed обновление",async()=>{
 const queries:string[]=[];
 const deps={db:{transaction:()=>Promise.reject(new Error("temporary failure")),query:(sql:string)=>{queries.push(sql);return Promise.resolve([]);}},audit:{}} as unknown as import("../../core/src/domains/registry/service.ts").RegistryDeps;
 const request=new Request("https://test/bot-webhook",{method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":RESIDENT_SECRET},body:JSON.stringify({update_id:701})});
 assertEquals((await handle(request,envWithSecret,deps)).status,500);assertEquals(queries.length,1);assertEquals(queries[0]!.includes("where bot_inbound.status<>'processed'"),true);
});
