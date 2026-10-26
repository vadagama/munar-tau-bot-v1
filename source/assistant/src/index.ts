// Точка входа Worker AI-ассистента (ADR-021). Worker — только транспорт:
// проверка Origin кабинета и передача WebSocket-upgrade в Durable Object
// сотрудника. Гейт JWT/enabled выполняет сам DO первым сообщением {type:"auth"}
// (JWT не в URL, план S1.2), поэтому до auth в DO ничего персонального не попадает.
//
// Эпоха: панель вычисляет эффективную эпоху max(конфиг, UTC-день) из
// settings/me и открывает WS на /ws?profile_id=...&epoch=...; «Очистить»
// (POST /v1/assistant/clear) поднимает эпоху — новый DO с пустой историей.

import { AssistantDO, type AssistantEnv } from "./do.ts";
import { assistantDoName } from "./almaty.ts";

export { AssistantDO };
export type { AssistantEnv };

const WS_PATH = "/ws";
/** Числовая граница эпохи: защита от мусора в query до обращения к DO. */
const MAX_EPOCH = 1e12;

function isUpgradable(request: Request): boolean {
  return request.headers.get("Upgrade") === "websocket";
}

export async function workerFetch(request: Request, env: AssistantEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== WS_PATH || !isUpgradable(request)) {
    return new Response("Not found", { status: 404 });
  }

  const origin = request.headers.get("Origin");
  const allowedOrigin = env.CABINET_ORIGIN;
  if (origin === null || allowedOrigin === undefined || allowedOrigin === "") {
    return new Response("Origin not allowed", { status: 403 });
  }
  if (origin !== allowedOrigin) {
    return new Response("Origin not allowed", { status: 403 });
  }

  const profileId = url.searchParams.get("profile_id") ?? "";
  const epochRaw = url.searchParams.get("epoch") ?? "";
  const epoch = Number(epochRaw);
  if (profileId === "" || !Number.isInteger(epoch) || epoch < 0 || epoch > MAX_EPOCH) {
    return new Response("profile_id and epoch are required", { status: 400 });
  }

  const name = assistantDoName(profileId, epoch);
  const stub = env.ASSISTANT.getByName(name);
  return stub.fetch(request);
}

export default {
  fetch: workerFetch,
} satisfies ExportedHandler<AssistantEnv>;
