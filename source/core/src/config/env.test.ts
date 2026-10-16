import { describe, expect, it } from "vitest";

import {
  ConfigError,
  envFromRecord,
  optionalEnv,
  requireEnv,
} from "./env.ts";

describe("requireEnv", () => {
  it("возвращает значение заданной переменной", () => {
    const env = envFromRecord({ TELEGRAM_BOT_TOKEN: "123:abc" });
    expect(requireEnv(env, "TELEGRAM_BOT_TOKEN")).toBe("123:abc");
  });

  it.each([undefined, ""])("бросает ConfigError для %p", (value) => {
    const env = envFromRecord({ TOKEN: value });
    expect(() => requireEnv(env, "TOKEN")).toThrow(ConfigError);
  });

  it("ConfigError содержит имя переменной", () => {
    const env = envFromRecord({});
    try {
      requireEnv(env, "X_JOBS_SECRET");
      expect.unreachable("должна быть выброшена ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variable).toBe("X_JOBS_SECRET");
    }
  });
});

describe("optionalEnv", () => {
  it.each([
    [{ A: "v" }, "A", "v"],
    [{ A: undefined }, "A", undefined],
    [{}, "A", undefined],
    [{ A: "" }, "A", undefined],
  ] as const)("record=%p, name=%p → %p", (record, name, expected) => {
    expect(optionalEnv(envFromRecord(record), name)).toBe(expected);
  });
});
