import { expect, it, vi } from "vitest";
import { listStaff, type RegistryDeps } from "./service.ts";
import type { Actor } from "../../pdp/types.ts";

const actor: Actor = {
  profile: { id: "p", personId: "n", language: "ru", isTest: false },
  person: { id: "n", fullName: "Имя", status: "active", isTest: false },
  assignments: [{ id: "a", role: "administrator", scopeBuildingIds: ["b1"],
    financialRights: false, registryExportRights: false, regulationsRights: false }],
  emulation: null,
};
function setup() {
  const query = vi.fn().mockResolvedValue([]);
  const deps: RegistryDeps = { db: { query, close: vi.fn(), transaction: vi.fn() }, audit: { append: vi.fn(), list: vi.fn() } };
  return { deps, query };
}
it("каталог сотрудников передаёт область администратора и признак тестовой персоны", async () => {
  const { deps, query } = setup();
  await listStaff(deps, actor);
  expect(query.mock.calls[0]![1]).toEqual([["b1"], false]);
  await listStaff(deps, { ...actor, person: { ...actor.person, isTest: true },
    emulation: { sessionId: "s", realPersonId: "r", realProfileId: "rp" } });
  expect(query.mock.calls[1]![1]).toEqual([["b1"], true]);
});
it("председатель читает весь ОСИ, исполнитель не получает доступ к каталогу", async () => {
  const { deps, query } = setup();
  await listStaff(deps, { ...actor, assignments: [{ ...actor.assignments[0]!, role: "chairman", scopeBuildingIds: undefined }] });
  expect(query.mock.calls[0]![1]).toEqual([null, false]);
  query.mockClear();
  await expect(listStaff(deps, { ...actor, assignments: [{ ...actor.assignments[0]!, role: "executor" }] })).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
