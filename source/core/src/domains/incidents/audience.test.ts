import { expect, it } from "vitest";
import type { DbExecutor } from "../../db/client.ts";
import { B1, makeTestActor } from "../../testing/actors.ts";
import { validateScope } from "./audience.ts";
const actor = makeTestActor("administrator", [B1]);
const db: DbExecutor = { query: async <T>() => [{ id: B1 }] as T[] };
it("зона не расширяет аудиторию до всего дома по одной текстовой метке", async () => {
  await expect(
    validateScope(db, actor, [{
      building_id: B1,
      service: "Вода",
      zone: "Подъезд 1",
    }]),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("пустой охват запрещён", async () => {
  await expect(validateScope(db, actor, [])).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
  });
});
it("дубликаты зоны не превращаются в отдельные восстановленные объекты", async () => {
  const zone = { building_id: B1, service: "Вода" };
  await expect(validateScope(db, actor, [zone, zone])).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
  });
});
it("помещения зоны проверяются по объекту и тестовому режиму", async () => {
  const absent: DbExecutor = {
    query: async <T>(sql: string) =>
      sql.includes("from building") ? [{ id: B1 }] as T[] : [],
  };
  await expect(
    validateScope(absent, actor, [{
      building_id: B1,
      service: "Вода",
      zone: "Подъезд",
      premises_ids: ["foreign"],
    }]),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("весь объект и явно выбранная зона представлены разными областями", async () => {
  expect(await validateScope(db, actor, [{ building_id: B1, service: "Вода" }]))
    .toEqual([{
      building_id: B1,
      service: "Вода",
      zone: "",
      premises_ids: [],
    }]);
});
