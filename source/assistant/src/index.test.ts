// Смоук-тест каркаса: алиас `cloudflare:workers` подменяется шимом, заглушки
// Worker/DO отвечают 501 до реализации среза S1.
import { describe, expect, it } from "vitest";
import { AssistantDO, workerFetch } from "./index.ts";

function fakeState() {
  return { id: { name: "assistant:profile:1" } } as unknown as DurableObjectState;
}

describe("workspace skeleton", () => {
  it("DO-заглушка отвечает 501", async () => {
    const stub = new AssistantDO(fakeState(), {});
    const response = await stub.fetch(new Request("https://assistant.example/ws"));
    expect(response.status).toBe(501);
  });

  it("Worker-заглушка требует Origin и отвечает 501", async () => {
    const withoutOrigin = await workerFetch(new Request("https://assistant.example/ws"));
    expect(withoutOrigin.status).toBe(400);
    const withOrigin = await workerFetch(
      new Request("https://assistant.example/ws", { headers: { Origin: "https://cabinet.example" } }),
    );
    expect(withOrigin.status).toBe(501);
  });
});
