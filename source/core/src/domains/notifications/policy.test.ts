import { expect, it } from "vitest";
import { deliveryMode, digestWindow, retryPolicy } from "./policy.ts";
it("NTF-03: обязательные сообщения и аварии невозможно отключить", () => {
  for (const mode of ["off", "digest", "immediate"] as const) {
    expect(deliveryMode("request.required", mode)).toBe("immediate");
    expect(deliveryMode("incident", mode)).toBe("immediate");
  }
  expect(deliveryMode("request.status", "off")).toBe("off");
  expect(deliveryMode("publication", "digest")).toBe("digest");
});
it("NTF-02: временная ошибка не окончательная; блокировка и пятая попытка окончательные", () => {
  expect(retryPolicy(1, {})).toEqual({
    failed: false,
    delay: 60,
    code: "DELIVERY_FAILED",
  });
  expect(retryPolicy(1, { retryAfter: 120 })).toMatchObject({
    failed: false,
    delay: 120,
  });
  expect(retryPolicy(5, {})).toMatchObject({ failed: true });
  expect(retryPolicy(1, { blocked: true })).toMatchObject({
    failed: true,
    code: "BLOCKED_BY_USER",
  });
});
it("NTF-01: сводка следует концу смены в часовом поясе ОСИ", () => {
  const p = {
    hours: 12,
    clock: "working" as const,
    start: 8,
    end: 20,
    timezone: "Asia/Almaty",
  };
  expect(digestWindow(new Date("2026-10-17T14:59:00Z"), p)).toBeNull();
  expect(digestWindow(new Date("2026-10-17T15:00:00Z"), p)).toBe("2026-10-17");
  expect(digestWindow(new Date("2026-10-17T15:00:00Z"), { ...p, end: 21 }))
    .toBeNull();
});

it("сводка смены до 24:00 доступна после полуночи, день сохраняется", () => {
  expect(
    digestWindow(new Date("2026-10-17T19:01:00Z"), {
      hours: 12,
      clock: "working",
      start: 8,
      end: 24,
      timezone: "Asia/Almaty",
    }),
  ).toBe("2026-10-17");
});
