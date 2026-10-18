import { expect, it } from "vitest";
import { validateImport } from "./import.ts";
import { emptyPayload } from "./workbook.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
const actor: Actor = {
  profile: { id: "p", personId: "n", language: "ru", isTest: false },
  person: { id: "n", fullName: "Имя", status: "active", isTest: false },
  assignments: [
    {
      id: "a",
      role: "chairman",
      scopeBuildingIds: undefined,
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
    },
  ],
  emulation: null,
};
const emptyDb: DbExecutor = { query: () => Promise.resolve([]) };
it("IMP-07: этаж и секция не разрешают повтор естественного ключа помещения", async () => {
  const p = emptyPayload();
  p.buildings = [{ key: "b", code: "1", name: "Дом" }];
  p.premises = [
    { key: "a", building_key: "b", kind: "apartment", number: "1", floor: 1 },
    { key: "b", building_key: "b", kind: "apartment", number: "1", floor: 2 },
  ];
  const report = await validateImport(emptyDb, actor, p);
  expect(report.errors).toHaveLength(1);
  expect(report.errors[0]?.sheet).toBe("Помещения");
});
it("IMP-07: название здания не разрешает повтор кода", async () => {
  const p = emptyPayload();
  p.buildings = [
    { key: "b1", code: "1", name: "Первое" },
    { key: "b2", code: "1", name: "Другое" },
  ];
  expect((await validateImport(emptyDb, actor, p)).errors).toHaveLength(1);
});
it("IMP-07: парковочное место существует в составе дома без отдельного паркинга", async () => {
  const p = emptyPayload();
  p.buildings = [{ key: "b", code: "1", name: "Дом" }];
  p.premises = [
    { key: "s", building_key: "b", kind: "parking_slot", number: "5" },
  ];
  const report = await validateImport(emptyDb, actor, p);
  expect(report.errors).toHaveLength(0);
  expect(report.added).toBe(2);
});
it("IMP-09: одинаковые телефоны в разных форматах блокируют файл", async () => {
  const p = emptyPayload();
  p.persons = [
    { key: "p1", full_name: "А", phone_e164: "87010000001" },
    { key: "p2", full_name: "Б", phone_e164: "+77010000001" },
  ];
  expect(
    (await validateImport(emptyDb, actor, p)).errors.some((e) =>
      e.reason.includes("Дублирующаяся"),
    ),
  ).toBe(true);
});
it("существующее здание сопоставляется по коду без типа", async () => {
  const p = emptyPayload();
  p.buildings = [{ key: "h", code: "1", name: "Дом" }];
  const db: DbExecutor = {
    query: <T>(sql: string) =>
      Promise.resolve(
        (sql === "select * from building"
          ? [{ id: "h-id", code: "1", name: "Дом" }]
          : []) as T[],
      ),
  };
  const report = await validateImport(db, actor, p);
  expect(report.errors).toHaveLength(0);
  expect(report.skipped).toBe(1);
});
