// Тесты политики сеансов AUTH-06: 12 часов от старта, 30 минут бездействия.

import { describe, expect, it } from "vitest";

import { checkSessionLimits, countsAsActivity, type AccessSessionRecord } from "./session.ts";

const session = (overrides: Partial<AccessSessionRecord> = {}): AccessSessionRecord => ({
  id: "s-1",
  profileId: "pr-1",
  startedAt: "2026-10-16T08:00:00Z",
  lastActivityAt: "2026-10-16T08:00:00Z",
  lastActivityKind: "start",
  revokedAt: null,
  ...overrides,
});

const NOW = new Date("2026-10-16T09:00:00Z"); // час после старта

describe("checkSessionLimits", () => {
  it("свежий сеанс проходит", () => {
    const fresh = session({ lastActivityAt: "2026-10-16T08:59:00Z" });
    expect(checkSessionLimits(fresh, NOW)).toEqual({ ok: true });
  });

  it("бездействие > 30 минут отклоняется", () => {
    const idle = session({ lastActivityAt: "2026-10-16T08:29:58Z" });
    const result = checkSessionLimits(idle, new Date("2026-10-16T08:59:59Z"));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("бездействия");
  });

  it("ровно 30 минут бездействия — ещё проходит", () => {
    const idle = session({ lastActivityAt: "2026-10-16T08:30:00Z" });
    expect(checkSessionLimits(idle, new Date("2026-10-16T09:00:00Z"))).toEqual({ ok: true });
  });

  it("сеанс длиннее 12 часов отклоняется даже с активностью", () => {
    const long = session({
      startedAt: "2026-10-15T20:00:00Z",
      lastActivityAt: "2026-10-16T08:59:00Z",
    });
    const result = checkSessionLimits(long, new Date("2026-10-16T08:01:00Z"));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("12 часов");
  });

  it("отозванный сеанс отклоняется с причиной отзыва", () => {
    const revoked = session({ revokedAt: "2026-10-16T08:30:00Z" });
    expect(checkSessionLimits(revoked, NOW)).toMatchObject({ ok: false });
  });
});

describe("countsAsActivity (М-2/AQ-03, согласовано 16.10.2026)", () => {
  it.each([
    ["GET", "/v1/meta/me", false],
    ["GET", "/v1/meta/health", false],
    ["GET", "/v1/meta/dictionary", false],
    ["GET", "/v1/audit", true],
    ["POST", "/v1/admin/assignments", true],
    ["GET", "/v1/admin/sessions", true],
    ["POST", "/v1/meta/me", true], // POST на meta — не чтение
  ] as const)("%s %s → %p", (method, path, expected) => {
    expect(countsAsActivity(method, path)).toBe(expected);
  });
});
