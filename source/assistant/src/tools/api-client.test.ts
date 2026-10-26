// Тесты клиента /v1 для инструментов сущностей (S2.1): Bearer JWT пользователя,
// коды ошибок LLD-03 §1.1, кэш языка профиля на изолят. fetch инъецируется —
// сетевых вызовов в тестах нет.

import { describe, expect, it } from "vitest";
import { ApiToolError, EntityApiClient } from "./api-client.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FakeOptions {
  status?: number;
  body?: unknown;
  /** fetch бросает исключение — имитация сетевого сбоя. */
  fail?: boolean;
  /** Тело не JSON — имитация некорректного ответа. */
  rawBody?: string;
}

function makeClient(options: FakeOptions = {}) {
  const calls: Array<{ path: string; jwt: string }> = [];
  const client = new EntityApiClient({
    getAccessToken: () => "jwt-user",
    fetchApi: async (path, jwt) => {
      calls.push({ path, jwt });
      if (options.fail) throw new Error("network down");
      if (options.rawBody !== undefined) {
        return new Response(options.rawBody, { status: options.status ?? 200 });
      }
      return jsonResponse(options.status ?? 200, options.body ?? {});
    },
  });
  return { client, calls };
}

describe("EntityApiClient.get", () => {
  it("ходит в /v1 с Bearer JWT и передаёт параметры запроса", async () => {
    const { client, calls } = makeClient({ body: { ok: true } });
    const result = await client.get("/v1/requests", { search: "лифт", state: "new" });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.jwt).toBe("jwt-user");
    const url = new URL(`https://do.test${calls[0]!.path}`);
    expect(url.pathname).toBe("/v1/requests");
    expect(url.searchParams.get("search")).toBe("лифт");
    expect(url.searchParams.get("state")).toBe("new");
  });

  it("без параметров путь остаётся без query", async () => {
    const { client, calls } = makeClient({ body: {} });
    await client.get("/v1/incidents");
    expect(calls[0]!.path).toBe("/v1/incidents");
  });

  it("ошибка HTTP превращается в ApiToolError со статусом и кодом API", async () => {
    const { client } = makeClient({ status: 403, body: { error: { code: "FORBIDDEN" } } });
    await expect(client.get("/v1/registry/persons")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("код ошибки не обязателен в теле ответа", async () => {
    const { client } = makeClient({ status: 404, body: {} });
    await expect(client.get("/v1/requests/x")).rejects.toMatchObject({ status: 404, code: null });
  });

  it("сетевой сбой — ApiToolError со статусом 0", async () => {
    const { client } = makeClient({ fail: true });
    await expect(client.get("/v1/tasks")).rejects.toMatchObject({ status: 0 });
  });

  it("не-JSON ответ при статусе 200 — ApiToolError", async () => {
    const { client } = makeClient({ rawBody: "<html>upstream</html>" });
    await expect(client.get("/v1/tasks")).rejects.toBeInstanceOf(ApiToolError);
  });

  it("без JWT изолята — отказ до вызова API", async () => {
    const calls: string[] = [];
    const client = new EntityApiClient({
      getAccessToken: () => undefined,
      fetchApi: async (path) => {
        calls.push(path);
        return jsonResponse(200, {});
      },
    });
    await expect(client.get("/v1/requests")).rejects.toMatchObject({ status: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("EntityApiClient.language", () => {
  it("читает язык профиля из /v1/meta/me и кэширует на изолят", async () => {
    const { client, calls } = makeClient({ body: { profile: { language: "kk" } } });
    expect(await client.language()).toBe("kk");
    expect(await client.language()).toBe("kk");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/v1/meta/me");
  });

  it("недоступный meta/me — язык по умолчанию ru, кэш не отравлен", async () => {
    const { client, calls } = makeClient({ status: 500 });
    expect(await client.language()).toBe("ru");
    expect(calls).toHaveLength(1);
  });

  it("неизвестное значение языка — ru", async () => {
    const { client } = makeClient({ body: { profile: { language: "fr" } } });
    expect(await client.language()).toBe("ru");
  });
});
