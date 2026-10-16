import { describe, expect, it } from "vitest";

import { ScenarioRegistry } from "./registry.ts";

describe("ScenarioRegistry", () => {
  it("пустой реестр — список идентификаторов пуст (VS-1)", () => {
    const registry = new ScenarioRegistry();
    expect(registry.listIds()).toEqual([]);
    expect(registry.get("любой")).toBeUndefined();
  });

  it("регистрирует сценарии и отдаёт идентификаторы отсортированно", () => {
    const registry = new ScenarioRegistry();
    registry.register({ id: "menu", description: "Меню", run: async () => "меню" });
    registry.register({ id: "balance", description: "Баланс", run: async () => "баланс" });
    expect(registry.listIds()).toEqual(["balance", "menu"]);
    expect(registry.get("menu")?.description).toBe("Меню");
    expect(registry.get("balance")).toBeDefined();
  });
});
