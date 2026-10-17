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
  p.buildings = [{ key: "b", kind: "house", code: "1", name: "Дом" }];
  p.premises = [
    { key: "a", building_key: "b", kind: "apartment", number: "1", floor: 1 },
    { key: "b", building_key: "b", kind: "apartment", number: "1", floor: 2 },
  ];
  const report = await validateImport(emptyDb, actor, p);
  expect(report.errors).toHaveLength(1);
  expect(report.errors[0]?.sheet).toBe("Помещения");
});
it("IMP-07: название здания не разрешает повтор kind/code", async () => {
  const p = emptyPayload();
  p.buildings = [
    { key: "b1", kind: "house", code: "1", name: "Первое" },
    { key: "b2", kind: "house", code: "1", name: "Другое" },
  ];
  expect((await validateImport(emptyDb, actor, p)).errors).toHaveLength(1);
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
it("повтор ссылки паркинга на дом виден до commit", async () => {
  const p = emptyPayload();
  p.buildings = [
    { key: "h", kind: "house", code: "1", name: "Дом" },
    {
      key: "p",
      kind: "parking",
      code: "P",
      name: "Паркинг",
      house_keys: "h,h",
    },
  ];
  expect(
    (await validateImport(emptyDb, actor, p)).errors.some(
      (e) => e.field === "house_keys",
    ),
  ).toBe(true);
});
it("точное совпадение связей паркинга сопоставляется и по ключам первоначального файла", async () => {
  const p = emptyPayload();
  p.buildings = [
    { key: "h", kind: "house", code: "1", name: "Дом" },
    { key: "p", kind: "parking", code: "P", name: "Паркинг", house_keys: "h" },
  ];
  const db: DbExecutor = {
    query: <T>(sql: string) =>
      Promise.resolve(
        (sql === "select * from building"
          ? [
              { id: "h-id", kind: "house", code: "1", name: "Дом" },
              { id: "p-id", kind: "parking", code: "P", name: "Паркинг" },
            ]
          : sql === "select parking_id,house_id from building_parking"
            ? [{ parking_id: "p-id", house_id: "h-id" }]
            : []) as T[],
      ),
  };
  const report = await validateImport(db, actor, p);
  expect(report.errors).toHaveLength(0);
  expect(report.skipped).toBe(2);
});
