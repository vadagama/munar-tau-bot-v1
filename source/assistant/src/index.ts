// Точка входа Worker AI-ассистента (ADR-021). Срез S1.1 — каркас воркспейса:
// заглушки маршрутизации и Durable Object, на их месте в следующих задачах
// будут Origin-гейт, upgrade WebSocket и DO с PiHarness.

import { DurableObject } from "cloudflare:workers";

export interface Env {
  /** Durable Object ассистента: один изолят на сотрудника и эпоху. */
  ASSISTANT: DurableObjectNamespace;
}

export class AssistantDO extends DurableObject {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("Assistant DO: not implemented yet", { status: 501 });
  }
}

export async function workerFetch(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin === null) {
    return new Response("Origin required", { status: 400 });
  }
  return new Response("Assistant worker: not implemented yet", { status: 501 });
}

export default {
  fetch: workerFetch,
} satisfies ExportedHandler<Env>;
