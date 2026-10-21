import { expect, it, vi } from "vitest";
import { deleteRegistry, type RegistryDeps } from "./service.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";

// Удаление зданий и помещений (жёсткий DELETE с каскадом — по прецеденту
// миграции remove_parking_buildings): связи, приглашения и анкеты помещения
// удаляются, обращения отвязываются, аварийные сигналы блокируют здание.

const chairman: Actor = {
  profile: { id: "p", personId: "n", language: "ru", isTest: false },
  person: { id: "n", fullName: "Председатель", status: "active", isTest: false },
  assignments: [{ id: "a", role: "chairman", scopeBuildingIds: undefined,
    financialRights: false, registryExportRights: false, regulationsRights: false }],
  emulation: null,
};

const administrator: Actor = {
  ...chairman,
  assignments: [{ id: "a", role: "administrator", scopeBuildingIds: ["b1"],
    financialRights: false, registryExportRights: false, regulationsRights: false }],
};

function setup(responses: Record<string, Record<string, unknown>[]>) {
  const calls: { sql: string; params: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    calls.push({ sql, params });
    const pattern = Object.keys(responses).find((key) => sql.includes(key));
    return pattern ? responses[pattern]! : [];
  });
  const append = vi.fn();
  const deps: RegistryDeps = {
    db: { query, close: vi.fn(), transaction: async (fn) => fn({ query } as unknown as DbExecutor) },
    audit: { append, list: vi.fn() },
  };
  return { deps, calls, append };
}

const PREMISES = [{ id: "prem-1", building_id: "b1", kind: "apartment", number: "1", is_test: false }];
const BUILDING = [{ id: "b1", code: "ДОМ-1", name: "Дом" }];

it("помещение удаляется с каскадом, обращения отвязываются, аудит с подсчётами", async () => {
  const { deps, calls, append } = setup({
    "from premises where id=$1 for update": PREMISES,
    "delete from connection where premises_id=$1": [{ id: "c1" }, { id: "c2" }],
    "delete from invite where premises_id=$1": [{ id: "i1" }],
    "delete from registration where premises_id=$1": [],
    "update request set premises_id=null where premises_id=$1": [{ id: "r1" }],
  });
  const result = await deleteRegistry(deps, administrator, "premises", "prem-1");
  expect(result).toEqual({ connections: 2, invites: 1, registrations: 0, requests_detached: 1 });
  const sqls = calls.map((c) => c.sql);
  expect(sqls).toEqual([
    "select * from premises where id=$1 for update",
    "delete from connection where premises_id=$1 returning id",
    "delete from invite where premises_id=$1 returning id",
    "delete from registration where premises_id=$1 returning id",
    "update request set premises_id=null where premises_id=$1 returning id",
    "delete from premises where id=$1",
  ]);
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0]![1]).toMatchObject({
    action: "registry.premises.delete",
    entityType: "premises",
    entityId: "prem-1",
    scopeBuildings: ["b1"],
    before: PREMISES[0],
    after: { deleted: true, connections: 2, invites: 1, registrations: 0, requests_detached: 1 },
  });
});

it("здание удаляется председателем: каскад по помещениям, области и дежурства, аудит", async () => {
  const { deps, calls, append } = setup({
    "from building where id=$1 for update": BUILDING,
    "from premises where building_id=$1": [{ id: "prem-1" }, { id: "prem-2" }],
    "delete from connection": [{ id: "c1" }],
    "update request set building_id=null where building_id=$1": [{ id: "r2" }],
  });
  const result = await deleteRegistry(deps, chairman, "buildings", "b1");
  // Каскад выполняется для каждого помещения; фейк возвращает по одной связи.
  expect(result).toEqual({ connections: 2, invites: 0, registrations: 0, requests_detached: 1 });
  const sqls = calls.map((c) => c.sql);
  expect(sqls[0]).toBe("select * from building where id=$1 for update");
  expect(sqls[1]).toBe("select 1 from emergency_signal where building_id=$1 limit 1");
  // Каскад по каждому из двух помещений.
  expect(sqls.filter((sql) => sql.startsWith("delete from connection"))).toHaveLength(2);
  expect(sqls).toContain("update request set premises_id=null where premises_id=$1 returning id");
  expect(sqls).toContain("update request set building_id=null where building_id=$1 returning id");
  expect(sqls.indexOf("update request set building_id=null where building_id=$1 returning id"))
    .toBeGreaterThan(sqls.indexOf("delete from premises where id=$1"));
  for (const table of ["duty_shift", "incident_scope", "publication_scope", "staff_scope"]) {
    expect(sqls).toContain(`delete from ${table} where building_id=$1`);
  }
  expect(sqls[sqls.length - 1]).toBe("delete from building where id=$1");
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0]![1]).toMatchObject({
    action: "registry.buildings.delete",
    entityType: "building",
    entityId: "b1",
    scopeBuildings: ["b1"],
    before: BUILDING[0],
  });
});

it("здание с аварийными сигналами не удаляется (журнал аварий append-only)", async () => {
  const { deps, calls, append } = setup({
    "from building where id=$1 for update": BUILDING,
    "from emergency_signal where building_id=$1 limit 1": [{ "?column?": 1 }],
  });
  await expect(deleteRegistry(deps, chairman, "buildings", "b1")).rejects.toMatchObject({
    code: "INVALID_TRANSITION",
  });
  expect(calls.some((c) => c.sql.startsWith("delete from"))).toBe(false);
  expect(append).not.toHaveBeenCalled();
});

it("не председатель здание не удаляет", async () => {
  const { deps, calls, append } = setup({ "from building where id=$1 for update": BUILDING });
  for (const actor of [administrator, { ...chairman, emulation: { sessionId: "s", realPersonId: "r", realProfileId: "rp" } }]) {
    await expect(deleteRegistry(deps, actor, "buildings", "b1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(calls.some((c) => c.sql.startsWith("delete from"))).toBe(false);
  expect(append).not.toHaveBeenCalled();
});

it("несуществующие здание и помещение — NOT_FOUND", async () => {
  const { deps } = setup({});
  await expect(deleteRegistry(deps, chairman, "buildings", "нет")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(deleteRegistry(deps, administrator, "premises", "нет")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("чужой тестовый домен помещения — NOT_FOUND, вне области — NOT_FOUND", async () => {
  const { deps, calls } = setup({
    "from premises where id=$1 for update": [{ ...PREMISES[0]!, is_test: true }],
  });
  await expect(deleteRegistry(deps, administrator, "premises", "prem-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(calls.some((c) => c.sql.startsWith("delete from"))).toBe(false);

  const outOfScope = setup({ "from premises where id=$1 for update": [{ ...PREMISES[0]!, building_id: "b2" }] });
  await expect(deleteRegistry(outOfScope.deps, administrator, "premises", "prem-1")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("лица и связи не удаляются этим маршрутом", async () => {
  const { deps } = setup({});
  for (const entity of ["persons", "connections"] as const) {
    await expect(deleteRegistry(deps, chairman, entity, "x")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  }
});
