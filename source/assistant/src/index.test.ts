// Тесты Worker-роутера (index.ts): только upgrade на /ws, Origin-гейт,
// валидация query и адресация DO по имени `assistant:<profile_id>:<epoch>`.
// DO-часть тестируется через ChatServer на фейках (Workers SQLite в Node
// недоступен), гейт и дни — своими тестами.

import { describe, expect, it, vi } from "vitest";
import { assistantDoName } from "./almaty.ts";
import type { AssistantEnv } from "./do.ts";

// do.ts тянет agents/lifecycle, который в рантайме импортирует cloudflare:workers —
// в Node это не загружается. Роутеру достаточно заглушки класса: DO мокается
// на уровне env.ASSISTANT.
vi.mock("./do.ts", () => ({ AssistantDO: class {} }));

const { workerFetch } = await import("./index.ts");

const ORIGIN = "https://cabinet.example";

function envWithCapture(): { env: AssistantEnv; names: string[] } {
  const names: string[] = [];
  const env = {
    CABINET_ORIGIN: ORIGIN,
    ASSISTANT: {
      getByName: (name: string) => {
        names.push(name);
        return {
          // Статус 101 в Node не собрать без настоящего WebSocket — для
          // проверки адресации достаточно любого успешного ответа заглушки.
          fetch: async () => new Response("passed-through", { status: 200 }),
        };
      },
    } as unknown as AssistantEnv["ASSISTANT"],
  };
  return { env, names };
}

function upgradeRequest(query = ""): Request {
  return new Request(`https://assistant.example/ws${query}`, {
    headers: { Upgrade: "websocket", Origin: ORIGIN },
  });
}

describe("workerFetch — маршрутизация", () => {
  it("не-/ws и не-upgrade — 404", async () => {
    const { env } = envWithCapture();
    expect((await workerFetch(new Request("https://assistant.example/other"), env)).status).toBe(404);
    expect((await workerFetch(new Request("https://assistant.example/ws"), env)).status).toBe(404);
  });

  it("нет Origin или не совпал с CABINET_ORIGIN — 403", async () => {
    const { env } = envWithCapture();
    const noOrigin = new Request("https://assistant.example/ws", { headers: { Upgrade: "websocket" } });
    expect((await workerFetch(noOrigin, env)).status).toBe(403);
    const foreign = new Request("https://assistant.example/ws", {
      headers: { Upgrade: "websocket", Origin: "https://evil.example" },
    });
    expect((await workerFetch(foreign, env)).status).toBe(403);
    const unset = envWithCapture();
    unset.env.CABINET_ORIGIN = undefined;
    expect((await workerFetch(upgradeRequest(), unset.env)).status).toBe(403);
  });

  it("невалидный query — 400", async () => {
    const { env } = envWithCapture();
    expect((await workerFetch(upgradeRequest("?epoch=1"), env)).status).toBe(400);
    expect((await workerFetch(upgradeRequest("?profile_id=p1&epoch=abc"), env)).status).toBe(400);
    expect((await workerFetch(upgradeRequest("?profile_id=p1&epoch=-1"), env)).status).toBe(400);
  });

  it("валидный upgrade адресуется в DO по имени и передаётся на fetch", async () => {
    const { env, names } = envWithCapture();
    const response = await workerFetch(upgradeRequest("?profile_id=profile-1&epoch=20752"), env);
    expect(response.status).toBe(200);
    expect(names).toEqual([assistantDoName("profile-1", 20752)]);
  });
});
