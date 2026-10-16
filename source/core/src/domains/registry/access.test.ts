import { expect, it } from "vitest";
import { registryScope, requireBuilding } from "./access.ts";
import type { Actor } from "../../pdp/types.ts";
const actor: Actor = {
  profile: { id: "p", personId: "n", language: "ru", isTest: false },
  person: { id: "n", fullName: "Имя", status: "active", isTest: false },
  assignments: [
    {
      id: "a",
      role: "administrator",
      scopeBuildingIds: ["b1"],
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
    },
  ],
  emulation: null,
};
it("администратор видит только назначенные дома", () => {
  expect(registryScope(actor)).toEqual(["b1"]);
  expect(() => requireBuilding(actor, "b2")).toThrow();
});
it("экспорт требует отдельного права и запрещён в эмуляции", () => {
  expect(() => registryScope(actor, true)).toThrow();
  const allowed = {
    ...actor,
    assignments: actor.assignments.map((a) => ({
      ...a,
      registryExportRights: true,
    })),
  };
  expect(registryScope(allowed, true)).toEqual(["b1"]);
  expect(() =>
    registryScope(
      {
        ...allowed,
        emulation: { sessionId: "s", realPersonId: "r", realProfileId: "rp" },
      },
      true,
    ),
  ).toThrow();
});
