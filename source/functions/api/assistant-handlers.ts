// Эндпоинты assistant (ADR-021, план S0.3): настройки (GET/PUT), свой доступ
// (settings/me), расход (usage), выдача runtime-token. Токен провайдера в
// ответах не возвращается — только маска; расшифрованное значение отдаёт
// POST /v1/assistant/runtime-token держателю валидного JWT с assistant.use.

import type { Route } from "./handlers.ts";
import {
  assistantSettingsView,
  assistantUsage,
  issueRuntimeToken,
  myAssistantAccess,
  saveAssistantSettings,
} from "../../core/src/domains/assistant/service.ts";

const read = "assistant.settings.read" as const;
const edit = "assistant.settings.edit" as const;
const usageRead = "assistant.usage.read" as const;

export const ASSISTANT_ROUTES: Route[] = [
  {
    method: "GET",
    path: "/v1/assistant/settings",
    action: read,
    evaluateAs: "effective",
    handler: async (c) => ({ body: await assistantSettingsView(c.deps, c.actor) }),
  },
  {
    method: "PUT",
    path: "/v1/assistant/settings",
    action: edit,
    evaluateAs: "effective",
    handler: async (c) => ({
      body: await saveAssistantSettings(
        c.deps,
        c.actor,
        c.body,
        c.request.headers.get("idempotency-key"),
      ),
    }),
  },
  {
    method: "GET",
    path: "/v1/assistant/settings/me",
    action: usageRead,
    evaluateAs: "effective",
    resource: (c) => ({ profileId: c.actor.profile.id }),
    handler: async (c) => ({ body: await myAssistantAccess(c.deps, c.actor) }),
  },
  {
    method: "GET",
    path: "/v1/assistant/usage",
    action: usageRead,
    evaluateAs: "effective",
    resource: (c) => ({ profileId: c.url.searchParams.get("profile_id") ?? c.actor.profile.id }),
    handler: async (c) => ({
      body: await assistantUsage(
        c.deps,
        c.actor,
        c.url.searchParams.get("profile_id") ?? undefined,
      ),
    }),
  },
  {
    method: "POST",
    path: "/v1/assistant/runtime-token",
    action: "assistant.use",
    evaluateAs: "effective",
    handler: async (c) => ({ body: await issueRuntimeToken(c.deps, c.actor) }),
  },
];
