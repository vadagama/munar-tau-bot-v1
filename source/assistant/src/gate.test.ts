// Тесты гейта: подпись JWT (реюз core/src/auth/jwt.ts по JWKS), enabled-флаг
// из settings/me, кэш ≤ 60 с, сверка профиля и эпохи. API подменяется инъекцией
// fetch; JWT подписывается тестовым ключом ES256 из core/src/testing/sign-jwt.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJwtKeyPair, type TestJwtKeyPair } from "./testing/sign-jwt.ts";
import { assistantDay } from "./almaty.ts";
import { AssistantGate, type AssistantAccessResponse } from "./gate.ts";

const NOW = new Date("2026-10-26T06:00:00Z");
const DAY = assistantDay(NOW);
const PROFILE = "profile-1";

function accessView(overrides: Partial<AssistantAccessResponse> = {}): AssistantAccessResponse {
  return {
    enabled: true,
    daily_token_limit: 50_000,
    monthly_token_limit: 1_000_000,
    day_used: 0,
    month_used: 0,
    day: "2026-10-26",
    month: "2026-10",
    profile_id: PROFILE,
    epoch: DAY,
    ...overrides,
  };
}

interface Harness {
  gate: AssistantGate;
  pair: TestJwtKeyPair;
  calls: string[];
  setView(view: AssistantAccessResponse | { status: number }): void;
  advance(ms: number): void;
}

let harness: Harness;

beforeEach(async () => {
  const pair = await createTestJwtKeyPair();
  let currentView: AssistantAccessResponse | { status: number } = accessView();
  let currentTime = NOW.getTime();
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    calls.push(String(input));
    if ("status" in currentView) {
      return new Response(JSON.stringify({ error: { code: "INTERNAL", message: "x", trace_id: "t" } }), {
        status: currentView.status,
      });
    }
    return new Response(JSON.stringify(currentView), { status: 200 });
  }) as typeof fetch;
  const gate = new AssistantGate({
    env: { SUPABASE_JWKS: pair.jwksJson(), SUPABASE_URL: "https://supabase.example/" },
    fetchFn,
    now: () => new Date(currentTime),
  });
  harness = {
    gate,
    pair,
    calls,
    setView(view) {
      currentView = view;
    },
    advance(ms) {
      currentTime += ms;
    },
  };
});

afterEach(() => {
  harness = undefined as unknown as Harness;
});

async function validJwt(): Promise<string> {
  return harness.pair.sign({ sub: "user-1", session_id: "s-1", exp: 10_000_000_000 });
}

describe("AssistantGate.authenticate", () => {
  it("валидный JWT включённого сотрудника — ok с профилем и эпохой DO", async () => {
    const decision = await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(decision).toEqual({ ok: true, profileId: PROFILE, epoch: DAY });
    expect(harness.calls[0]).toContain("/functions/v1/api/v1/assistant/settings/me");
  });

  it("поддельный токен (ключ не из JWKS) — отказ", async () => {
    const foreign = await createTestJwtKeyPair("foreign");
    const decision = await harness.gate.authenticate(await foreign.sign({ sub: "user-1" }), PROFILE, DAY);
    expect(decision.ok).toBe(false);
  });

  it("выключенный сотрудник — отказ с причиной", async () => {
    harness.setView(accessView({ enabled: false }));
    const decision = await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(decision).toMatchObject({ ok: false, reason: "Ассистент выключен для этого сотрудника" });
  });

  it("JWT другого профиля — отказ (токен не владелец DO)", async () => {
    harness.setView(accessView({ profile_id: "profile-2" }));
    const decision = await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(decision).toMatchObject({ ok: false, reason: "Токен принадлежит другому профилю" });
  });

  it("истёкший токен — отказ", async () => {
    const decision = await harness.gate.authenticate(
      await harness.pair.sign({ sub: "user-1", exp: 1000 }),
      PROFILE,
      DAY,
    );
    expect(decision.ok).toBe(false);
  });

  it("ошибка API (500) — отказ без деталей", async () => {
    harness.setView({ status: 500 });
    const decision = await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(decision).toMatchObject({ ok: false, reason: "Не удалось подтвердить доступ ассистента" });
  });

  it("отсутствие SUPABASE_JWKS — отказ с понятной причиной", async () => {
    const pair = harness.pair;
    const broken = new AssistantGate({ env: { SUPABASE_URL: "https://supabase.example" } });
    const decision = await broken.authenticate(await pair.sign({ sub: "user-1" }), PROFILE, DAY);
    expect(decision).toMatchObject({ ok: false, reason: "Секрет SUPABASE_JWKS не настроен для Worker" });
  });
});

describe("AssistantGate — кэш и эпоха", () => {
  it("повторный auth в пределах 60 с не ходит в API повторно", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(harness.calls).toHaveLength(1);
  });

  it("после 60 с кэш протухает — API вызывается снова", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    harness.advance(60_001);
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(harness.calls).toHaveLength(2);
  });

  it("checkEpoch: включён и эпоха актуальна — ok", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    await expect(harness.gate.checkEpoch(PROFILE, DAY)).resolves.toBe("ok");
  });

  it("checkEpoch: ручная очистка подняла конфиг-эпоху — stale", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    harness.setView(accessView({ epoch: DAY + 1 }));
    harness.advance(60_001); // кэш протух, перечитали новую эпоху
    await expect(harness.gate.checkEpoch(PROFILE, DAY)).resolves.toBe("stale");
  });

  it("checkEpoch: наступил день 05:00 — stale без перечитывания конфига", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    harness.advance(86_400_000); // следующие сутки UTC = 05:00 Алматы
    await expect(harness.gate.checkEpoch(PROFILE, DAY)).resolves.toBe("stale");
  });

  it("checkEpoch: сотрудника выключили — stale", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    harness.setView(accessView({ enabled: false }));
    harness.advance(60_001);
    await expect(harness.gate.checkEpoch(PROFILE, DAY)).resolves.toBe("stale");
  });

  it("checkEpoch без аутентификации — stale", async () => {
    await expect(harness.gate.checkEpoch(PROFILE, DAY)).resolves.toBe("stale");
  });

  it("invalidate() заставляет перечитать доступ", async () => {
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    harness.gate.invalidate();
    await harness.gate.authenticate(await validJwt(), PROFILE, DAY);
    expect(harness.calls).toHaveLength(2);
  });
});
