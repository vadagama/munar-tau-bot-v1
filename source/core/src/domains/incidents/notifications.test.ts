import { expect, it } from "vitest";
import type { DbExecutor } from "../../db/client.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
import { noticeAllowed } from "../notifications/service.ts";
const exec: DbExecutor = {
  query: async <T>() =>
    [{
      building_id: B1,
      is_test: false,
      responsible_person_id: "current",
    }] as T[],
};
it("отложенный срочный сигнал не доставляется бывшему дежурному", async () => {
  const previous = makeTestActor("duty", [B1], { personId: "previous" });
  const current = makeTestActor("duty", [B1], { personId: "current" });
  const notice = {
    signalId: "signal",
    type: "incident" as const,
    isTest: false,
  };
  expect(await noticeAllowed(exec, previous, notice)).toBe(false);
  expect(await noticeAllowed(exec, current, notice)).toBe(true);
  expect(
    await noticeAllowed(exec, makeTestActor("administrator", [B2]), notice),
  ).toBe(false);
  expect(
    await noticeAllowed(exec, makeTestActor("administrator", [B1]), notice),
  ).toBe(true);
});
it("резервный маршрут недоставки проверяет действующую роль и область", async () => {
  const actor = makeTestActor("duty", [B1]);
  const notice = {
    type: "incident" as const,
    audience: "staff" as const,
    buildingIds: [B1],
    isTest: false,
  };
  expect(await noticeAllowed(exec, actor, notice)).toBe(true);
  actor.assignments = [];
  expect(await noticeAllowed(exec, actor, notice)).toBe(false);
});
it("архивированная публикация отменяет ещё не отправленное уведомление", async () => {
  const db: DbExecutor = { query: async () => [] };
  expect(
    await noticeAllowed(db, makeTestActor("administrator", [B1]), {
      publicationId: "archived",
    }),
  ).toBe(false);
});
