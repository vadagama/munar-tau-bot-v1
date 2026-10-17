import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("API region routing", () => {
  it.each(["ap-southeast-2", ""])("сохраняет фильтры журнала при регионе '%s'", async (region) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubEnv("VITE_SUPABASE_FUNCTION_REGION", region);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ entries: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api");
    await apiFetch("/v1/audit", { query: { limit: "50", entity_type: "person" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url.pathname).toBe("/functions/v1/api/v1/audit");
    expect(url.searchParams.get("forceFunctionRegion")).toBe(region || null);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("entity_type")).toBe("person");
    expect(init.headers.authorization).toBe("Bearer test-token");
  });
});
