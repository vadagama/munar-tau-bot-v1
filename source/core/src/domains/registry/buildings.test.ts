import { expect, it, vi } from "vitest";
import { mutateRegistry, type RegistryDeps } from "./service.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";

const chairman: Actor = {
  profile: { id: "p", personId: "n", language: "ru", isTest: false },
  person: { id: "n", fullName: "Председатель", status: "active", isTest: false },
  assignments: [{ id: "a", role: "chairman", scopeBuildingIds: undefined,
    financialRights: false, registryExportRights: false, regulationsRights: false }],
  emulation: null,
};

function setup() {
  const before = { id: "b1", code: "ДОМ-1", name: "Дом", construction_phase: 3 };
  const query = vi.fn().mockResolvedValue([before]);
  const append = vi.fn();
  const deps: RegistryDeps = {
    db: { query, close: vi.fn(), transaction: async fn => fn({ query } as DbExecutor) },
    audit: { append, list: vi.fn() },
  };
  return { deps, query, append };
}

it.each([
  [{ name: "Новое название" }, 3],
  [{ construction_phase: 5 }, 5],
  [{ construction_phase: null }, null],
] as const)("PATCH здания сохраняет очередь: %j", async (input, phase) => {
  const { deps, query, append } = setup();
  await mutateRegistry(deps, chairman, "buildings", input, "b1");
  // Проверяем границу сервиса и SQL: пропуск поля и очистка различаются.
  expect(query).toHaveBeenLastCalledWith(
    "update building set code=$1,name=$2,construction_phase=$3 where id=$4 returning *",
    ["ДОМ-1", "name" in input ? input.name : "Дом", phase, "b1"],
  );
  expect(append).toHaveBeenCalledOnce();
});

it("создание выводит код из названия, очередь — NULL", async () => {
  const { deps, query } = setup();
  await mutateRegistry(deps, chairman, "buildings", { name: "ДОМ-2" });
  expect(query).toHaveBeenCalledWith(
    "insert into building (code,name,construction_phase) values ($1,$2,$3) returning *",
    ["ДОМ-2", "ДОМ-2", null],
  );
});

it("явный код сохраняется: технический ключ импорта не теряется", async () => {
  const { deps, query } = setup();
  await mutateRegistry(deps, chairman, "buildings", { code: "КЛЮЧ", name: "Дом 2" });
  expect(query).toHaveBeenCalledWith(
    "insert into building (code,name,construction_phase) values ($1,$2,$3) returning *",
    ["КЛЮЧ", "Дом 2", null],
  );
});

it("неверная очередь отклоняется до записи и аудита", async () => {
  const { deps, query, append } = setup();
  await expect(mutateRegistry(deps, chairman, "buildings", { construction_phase: 6 }, "b1")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(query).toHaveBeenCalledTimes(2); // Gate и чтение прежней записи.
  expect(query).toHaveBeenNthCalledWith(1, "select public.audience_clock()");
  expect(append).not.toHaveBeenCalled();
});

it("очередь не даёт изменять здание администратору или в эмуляции", async () => {
  const { deps, append } = setup();
  for (const actor of [
    { ...chairman, assignments: [{ ...chairman.assignments[0]!, role: "administrator" as const }] },
    { ...chairman, emulation: { sessionId: "s", realPersonId: "r", realProfileId: "rp" } },
  ]) {
    await expect(mutateRegistry(deps, actor, "buildings", { construction_phase: 2 }, "b1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(append).not.toHaveBeenCalled();
});
