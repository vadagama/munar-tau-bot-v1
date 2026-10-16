import { expect, it } from "vitest";
import { jsonValue } from "./validation.ts";
it("JSONB pooler: принимает и объект, и текст без двойной сериализации", () => {
  const value = { buildings: [], premises: [], persons: [], connections: [] };
  expect(jsonValue(JSON.stringify(value))).toEqual(value);
  expect(jsonValue(value)).toBe(value);
});
