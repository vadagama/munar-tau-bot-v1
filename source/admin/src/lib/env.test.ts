// Тесты публичных переменных среды кабинета (ADR-002): только publishable-
// значения; без env — режим заглушки (VS-0), вход заблокирован.

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("appEnv", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("без переменных — режим заглушки: configured=false, apiUrl=null", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const { appEnv } = await import("./env");
    expect(appEnv.configured).toBe(false);
    expect(appEnv.supabaseUrl).toBeNull();
    expect(appEnv.supabaseKey).toBeNull();
    expect(appEnv.apiUrl).toBeNull();
  });

  it("с переменными — configured=true, слэш на конце url обрезается", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://fuwsmewtmxmzttwkbdex.supabase.co/");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-key");
    const { appEnv } = await import("./env");
    expect(appEnv.configured).toBe(true);
    expect(appEnv.supabaseUrl).toBe("https://fuwsmewtmxmzttwkbdex.supabase.co");
    expect(appEnv.supabaseKey).toBe("sb_publishable_test-key");
    expect(appEnv.apiUrl).toBe("https://fuwsmewtmxmzttwkbdex.supabase.co/functions/v1/api");
  });
});
