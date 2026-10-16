// Функция api — единый роутер REST /v1 (LLD-01 §2, LLD-03).
// Конвейер VS-1 (план среза): CORS/preflight → health → JWT (HS256) → профиль
// (NO_PROFILE) → сеанс (ensure/touch/check SESSION_EXPIRED) → Actor (+эмуляция)
// → маршрут → PDP → обработчик → аудит отказов/чтения журнала → ответы
// no-store + CORS. Проверка полномочий — на сервере при каждом запросе (PDP).
//
// Защита: verify_jwt = true проверяет Bearer на платформе (supabase/config.toml);
// собственная проверка подписи HS256 — вторая линия (AGENTS.md, границы).

import { type EnvSource, optionalEnv } from "../../core/src/config/env.ts";
import { ApiError } from "../../core/src/errors/api.ts";
import { verifyJwt } from "../../core/src/auth/jwt.ts";
import { checkSessionLimits, countsAsActivity } from "../../core/src/auth/session.ts";
import { can } from "../../core/src/pdp/evaluate.ts";
import type { ResourceRef } from "../../core/src/pdp/types.ts";
import type { Actor } from "../../core/src/pdp/types.ts";
import { buildActorForProfile, findProfileForAuth } from "../../core/src/domains/admin/actor-service.ts";
import { resolveEffectiveActor } from "../../core/src/domains/emulation/service.ts";
import { buildAuditInput } from "../../core/src/domains/audit/entry.ts";
import { defaultDeps, type ApiDeps } from "./deps.ts";

export { defaultDeps, type ApiDeps };
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJsonBody,
} from "./http.ts";
import { matchRoute, type RouteContext } from "./handlers.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Ответ health-check: без персональных данных (LLD-03 §3.1, OPS-02). */
function health(): Response {
  return new Response(
    JSON.stringify({ status: "ok", service: "api", time: new Date().toISOString() }),
    { status: 200, headers: { ...JSON_HEADERS, "cache-control": "no-store" } },
  );
}

/** Bearer-токен из заголовка; отсутствие — UNAUTHENTICATED. */
function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) {
    throw new ApiError("UNAUTHENTICATED");
  }
  const token = header.slice("Bearer ".length).trim();
  if (token === "") throw new ApiError("UNAUTHENTICATED");
  return token;
}

/** Путь внутри функции: /functions/v1/api/v1/... → /v1/... */
function normalizePath(pathname: string): string {
  const index = pathname.indexOf("/v1/");
  return index === -1 ? "/" : pathname.slice(index);
}

interface RequestContext {
  request: Request;
  url: URL;
  path: string;
  cabinetOrigin: string | undefined;
  getDeps: () => Promise<ApiDeps>;
}

/**
 * Обработка запроса. Зависимости читаются лениво (после проверки заголовка):
 * smoke-тесты без env получают 401, а не ошибку конфигурации.
 */
async function processRequest(ctx: RequestContext): Promise<Response> {
  const { request, url, path, cabinetOrigin } = ctx;
  try {
    if (request.method === "OPTIONS") {
      return preflightResponse(request, cabinetOrigin);
    }

    if (request.method === "GET" && path === "/v1/meta/health") {
      return health();
    }

    // ── Аутентификация (ADR-001, LLD-03 §1) ────────────────────────────
    const token = bearerToken(request);
    const deps = await ctx.getDeps();
    const claims = await verifyJwt(token, deps.jwtKeys);
    if (claims.sessionId === null) {
      throw new ApiError("UNAUTHENTICATED", "В токене нет идентификатора сеанса");
    }

    // ── Профиль (вход не выдаёт роль) и сеанс (AUTH-06) ─────────────────────
    const now = new Date();
    const profile = await findProfileForAuth(deps.admin, deps.db, claims.sub);
    const session = await deps.admin.ensureAccessSession(deps.db, claims.sessionId, profile.id, now);
    const limits = checkSessionLimits(session, now);
    if (!limits.ok) {
      throw new ApiError("SESSION_EXPIRED", limits.reason);
    }

    // ── Actor: реальный и эффективный (эмулированный, HLD 10.8) ────────────
    const realActor = await buildActorForProfile(deps.admin, deps.db, profile, now);
    const actor = await resolveEffectiveActor(
      { admin: deps.admin, emulation: deps.emulation },
      deps.db,
      realActor,
      now,
    );

    // ── Маршрут ─────────────────────────────────────────────────────────────
    const matched = matchRoute(request.method, path);
    if (!matched) {
      throw new ApiError("NOT_FOUND", "Маршрут не найден");
    }

    // Активность сеанса: все вызовы кроме GET /v1/meta/* (М-2/AQ-03).
    if (countsAsActivity(request.method, path)) {
      await deps.admin.touchAccessSession(
        deps.db,
        session.id,
        `${request.method} ${matched.route.path}`,
        new Date(),
      );
    }

    const routeCtx: RouteContext = {
      request,
      url,
      deps,
      actor,
      realActor,
      session,
      params: matched.params,
      body: await readBodyFor(request.method, request),
    };

    // ── PDP (LLD-01 §3.1): оценка эффективным или реальным актором ─────────
    const resource: ResourceRef = matched.route.resource
      ? await matched.route.resource(routeCtx)
      : {};
    const evaluateActor: Actor = matched.route.evaluateAs === "real" ? realActor : actor;
    const decision = can(evaluateActor, matched.route.action, resource);
    if (!decision.allow) {
      // Отказ — событие журнала (AUD-01); сбой журнала не превращает 403 в 500.
      try {
        await deps.audit.append(deps.db, buildAuditInput(evaluateActor, {
          action: matched.route.action,
          entityType: "access",
          reason: decision.reason,
          meta: { method: request.method, path: url.pathname },
        }));
      } catch {
        // журнал недоступен — отказ всё равно возвращается
      }
      throw new ApiError("FORBIDDEN", decision.reason);
    }

    const result = await matched.route.handler(routeCtx);
    return jsonResponse(request, cabinetOrigin, result.status ?? 200, result.body);
  } catch (error) {
    return errorResponse(request, cabinetOrigin, error);
  }
}

/** Тело читается только у методов с содержимым (LLD-03 §1). */
function readBodyFor(method: string, request: Request): Promise<Record<string, unknown>> {
  if (method === "GET" || method === "DELETE") return Promise.resolve({});
  return readJsonBody(request);
}

/**
 * Продакшн-вход: зависимости из env. SUPABASE_JWKS и SUPABASE_DB_URL
 * инжектируются платформой; CABINET_ORIGIN — наш секрет функции. CORS-заголовки
 * резолвятся до зависимостей — preflight и smoke-запросы без токена не требуют
 * конфигурации.
 */
export function handle(request: Request, env: EnvSource): Promise<Response> {
  return processRequest({
    request,
    url: new URL(request.url),
    path: normalizePath(new URL(request.url).pathname),
    cabinetOrigin: optionalEnv(env, "CABINET_ORIGIN"),
    getDeps: () => defaultDeps(env),
  });
}

/** Вход для тестов: зависимости подставлены (фейки вместо БД). */
export function handleWithDeps(request: Request, deps: ApiDeps): Promise<Response> {
  return processRequest({
    request,
    url: new URL(request.url),
    path: normalizePath(new URL(request.url).pathname),
    cabinetOrigin: deps.cabinetOrigin,
    getDeps: () => Promise.resolve(deps),
  });
}

if (import.meta.main) {
  Deno.serve((request: Request) => handle(request, (name) => Deno.env.get(name)));
}
