// Политика сеансов AUTH-06 (LLD-03 §1, LLD-02 §13): сеанс ≤ 12 часов от старта,
// 30 минут бездействия; обновление токенов Auth пределы не продлевает.
// Активность — все аутентифицированные вызовы /v1, кроме GET /v1/meta/*
// (согласовано 16.10.2026, М-2/AQ-03).

import { SESSION_IDLE_LIMIT_MS, SESSION_TOTAL_LIMIT_MS } from "../pdp/actor.ts";

/** Запись access_session (LLD-02 §13). */
export interface AccessSessionRecord {
  id: string;
  profileId: string;
  startedAt: string;
  lastActivityAt: string;
  lastActivityKind: string;
  revokedAt: string | null;
}

export type SessionCheck = { ok: true } | { ok: false; reason: string };

/** Проверка пределов сеанса на момент now. Чистая функция — тесты таблицей. */
export function checkSessionLimits(session: AccessSessionRecord, now: Date): SessionCheck {
  if (session.revokedAt !== null) {
    return { ok: false, reason: "Сеанс завершён (отзыв)" };
  }
  const startedAt = new Date(session.startedAt).getTime();
  if (now.getTime() - startedAt > SESSION_TOTAL_LIMIT_MS) {
    return { ok: false, reason: "Сеанс превысил 12 часов (AUTH-06)" };
  }
  const lastActivityAt = new Date(session.lastActivityAt).getTime();
  if (now.getTime() - lastActivityAt > SESSION_IDLE_LIMIT_MS) {
    return { ok: false, reason: "Сеанс завершён после 30 минут бездействия (AUTH-06)" };
  }
  return { ok: true };
}

/** Активность ли это для сеанса: meta-чтения пределы не продлевают (М-2). */
export function countsAsActivity(method: string, path: string): boolean {
  return !(method === "GET" && path.startsWith("/v1/meta/"));
}
