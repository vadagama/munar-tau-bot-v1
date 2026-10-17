import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCallbackErrorFromLocation } from "./auth-callback";

describe("readCallbackErrorFromLocation", () => {
  afterEach(() => {
    window.history.replaceState(window.history.state, "", "/");
  });

  it("читает ошибку из фрагмента URL (имплицитный поток, #error=...)", () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/#error=access_denied&error_description=Signups+not+allowed+for+this+instance",
    );
    expect(readCallbackErrorFromLocation()).toEqual({
      error: "access_denied",
      description: "Signups not allowed for this instance",
    });
  });

  it("читает ошибку из строки запроса (редирект-ошибка PKCE, ?error=...)", () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/login?error=server_error&error_code=bad_oauth_callback&error_description=Callback+failed",
    );
    expect(readCallbackErrorFromLocation()).toEqual({
      error: "server_error",
      description: "Callback failed",
    });
  });

  it("приоритет у строки запроса, если фрагмент тоже содержит error", () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/login?error=query_error&error_description=%D0%B8%D0%B7+%D0%B7%D0%B0%D0%BF%D1%80%D0%BE%D1%81%D0%B0#error=fragment_error",
    );
    const result = readCallbackErrorFromLocation();
    expect(result?.error).toBe("query_error");
  });

  it("без параметров ошибки возвращает null", () => {
    window.history.replaceState(window.history.state, "", "/?code=abc&other=1");
    expect(readCallbackErrorFromLocation()).toBeNull();
  });
});

describe("hadPkceCodeAtLoad (фиксация при загрузке модуля)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    window.history.replaceState(window.history.state, "", "/");
  });

  it("true, если страница загружена с ?code= (возврат PKCE)", async () => {
    window.history.replaceState(window.history.state, "", "/?code=auth-code-1");
    const { hadPkceCodeAtLoad } = await import("./auth-callback");
    expect(hadPkceCodeAtLoad()).toBe(true);
  });

  it("false без кода в URL", async () => {
    window.history.replaceState(window.history.state, "", "/login?error=server_error");
    const { hadPkceCodeAtLoad } = await import("./auth-callback");
    expect(hadPkceCodeAtLoad()).toBe(false);
  });

  it("false, если код появился в URL уже после загрузки модуля", async () => {
    window.history.replaceState(window.history.state, "", "/login");
    const { hadPkceCodeAtLoad } = await import("./auth-callback");
    window.history.replaceState(window.history.state, "", "/?code=late-code");
    expect(hadPkceCodeAtLoad()).toBe(false);
  });
});
