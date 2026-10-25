import { expect, it } from "vitest";
import { inform, informManagers } from "./service.ts";
import type { RequestRow } from "./access.ts";
import type { DbExecutor } from "../../db/client.ts";

const row = {
  id: "r1",
  author_person_id: "author",
  premises_id: "p1",
  building_id: "b1",
  state: "in_work",
  is_test: true,
  version: 1,
  kind: "request",
  complaint_subject_person_id: null,
  complaint_route: "administrator",
  number: "З-26-1",
  confirmation_version: 1,
} as RequestRow;

const NOTICE = { ru: "т", kk: "т" };

/** Фейк exec: отвечает на выборки получателей и пишет в outbox вставки в captured. */
function execFake(
  participants: string[],
  managers: string[],
  captured: { sql: string; params: readonly unknown[] }[],
): DbExecutor {
  return {
    query: async (sql: string, params?: readonly unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      if (sql.startsWith("select p.person_id from request_participant")) {
        return participants.map((id) => ({ person_id: id }));
      }
      if (sql.startsWith("select distinct a.person_id from staff_assignment")) {
        return managers.map((id) => ({ person_id: id }));
      }
      return [];
    },
  } as unknown as DbExecutor;
}

/** personId получателей уведомлений (insert into outbox ... 'notification.requested'). */
function notified(captured: { sql: string; params: readonly unknown[] }[]) {
  return captured
    .filter((c) => c.sql.startsWith("insert into outbox"))
    .map((c) => JSON.parse(String(c.params[0])).personId as string);
}

it("inform: автор уведомляется по умолчанию и исключается по actor", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const exec = execFake([], [], captured);
  await inform(exec, row, NOTICE, "k1", false, true);
  expect(notified(captured)).toEqual(["author"]);
  captured.length = 0;
  await inform(exec, row, NOTICE, "k1", false, true, "author");
  expect(notified(captured)).toEqual([]);
});

it("inform: участник получает уведомление, автор-actor не получает своего", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const exec = execFake(["author", "p1"], [], captured);
  await inform(exec, row, NOTICE, "k1", true, true);
  expect(notified(captured)).toEqual(["author", "p1"]);
  captured.length = 0;
  // Actor — участник p1: автора уведомляем, самого p1 — нет.
  await inform(exec, row, NOTICE, "k1", true, true, "p1");
  expect(notified(captured)).toEqual(["author"]);
});

it("informManagers: исключение актора уходит в SQL-параметр выборки", async () => {
  const captured: { sql: string; params: readonly unknown[] }[] = [];
  const exec = execFake([], ["m1", "m2"], captured);
  await informManagers(exec, row, NOTICE, "k1");
  // Мок возвращает весь список управляющих: фильтр исключения живёт в SQL,
  // поэтому проверяем параметр $4 выборки (NULL — без исключения).
  const select = captured.find((c) =>
    c.sql.startsWith("select distinct a.person_id from staff_assignment")
  );
  expect(select?.params?.[3]).toBe(null);
  expect(notified(captured)).toEqual(["m1", "m2"]);
  captured.length = 0;
  await informManagers(exec, row, NOTICE, "k1", "m1");
  const selected = captured.find((c) =>
    c.sql.startsWith("select distinct a.person_id from staff_assignment")
  );
  expect(selected?.params?.[3]).toBe("m1");
  expect(String(selected?.sql)).toContain("is distinct from $4::uuid");
});
