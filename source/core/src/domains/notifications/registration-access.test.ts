import { expect, it } from "vitest";
import { noticeAllowed } from "./service.ts";
import { makeTestActor } from "../../testing/actors.ts";
import type { DbExecutor } from "../../db/client.ts";
const exec: DbExecutor = { query: async <T>() => [] as T[] };
it("анкета без помещения: проверяющий получает уведомление только с действующим правом", async () => {
  const notice = { registrationAccess: { premisesId: null, role: "administrator" } };
  expect(await noticeAllowed(exec, makeTestActor("administrator", []), notice)).toBe(true);
  expect(await noticeAllowed(exec, makeTestActor("executor", []), notice)).toBe(false);
  expect(await noticeAllowed(exec, makeTestActor("tech_admin", []), notice)).toBe(true);
});
it("анкета помещения: прекращённая связь собственника запрещает отложенное уведомление", async () => {
  const db: DbExecutor = { query: async <T>(sql: string) => sql.startsWith("select building_id") ? [{ building_id: "b1", is_test: false }] as T[] : [] };
  expect(await noticeAllowed(db, makeTestActor("administrator", []), { registrationAccess: { premisesId: "p1", role: "owner" } })).toBe(false);
});
