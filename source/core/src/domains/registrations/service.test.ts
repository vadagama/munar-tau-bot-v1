import { expect, it } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { AuditRepo } from "../audit/port.ts";
import { reviewRegistration } from "./service.ts";
import type { Row } from "../registry/validation.ts";
const actor: Actor = {
  person: {
    id: "admin",
    fullName: "Администратор",
    status: "active",
    isTest: false,
  },
  profile: { id: "profile", personId: "admin", language: "ru", isTest: false },
  assignments: [
    {
      id: "a",
      role: "administrator",
      scopeBuildingIds: ["building"],
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
    },
  ],
  emulation: null,
};
function harness(registration: Row) {
  const writes: string[] = [];
  const exec: DbExecutor = {
    query: <T>(query: string) => {
      if (query.startsWith("select * from registration"))
        return Promise.resolve([
          {
            id: "r",
            is_test: false,
            premises_id: "p",
            state: "pending_review",
            review_stage: "administrator",
            ...registration,
          },
        ] as T[]);
      if (query.startsWith("select * from premises"))
        return Promise.resolve([
          {
            id: "p",
            building_id: "building",
            is_test: false,
            kind: "apartment",
          },
        ] as T[]);
      writes.push(query);
      return Promise.resolve([]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  const audit: AuditRepo = {
    append: () => Promise.reject(new Error("не должен писать аудит успеха")),
    list: () => Promise.reject(new Error("unused")),
  };
  return { deps: { db, audit }, writes };
}
it("эмулируемый сотрудник не принимает настоящую анкету без person_id", async () => {
  const h = harness({ person_id: null });
  await expect(
    reviewRegistration(
      h.deps,
      {
        ...actor,
        person: { ...actor.person, isTest: true },
        emulation: {
          sessionId: "s",
          realPersonId: "real",
          realProfileId: "rp",
        },
      },
      "r",
      "approve",
      { reason: "Проверено" },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(h.writes).toHaveLength(0);
});
it("администратор не обходит 48 часов ожидания собственника", async () => {
  const h = harness({ review_stage: "owner" });
  await expect(
    reviewRegistration(h.deps, actor, "r", "approve", { reason: "Проверено" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(h.writes).toHaveLength(0);
});
it("заместитель не решает анкету до передачи на его этап", async () => {
  const h = harness({ review_stage: "administrator" });
  await expect(
    reviewRegistration(
      h.deps,
      {
        ...actor,
        assignments: actor.assignments.map((a) => ({ ...a, role: "deputy" })),
      },
      "r",
      "approve",
      { reason: "Проверено" },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("уточнение не позволяет сотруднику рассмотреть спор о своих действиях", async () => {
  const h = harness({
    state: "need_clarification",
    total_due_at: "2026-10-20",
    dispute_checker_id: actor.person.id,
  });
  await expect(
    reviewRegistration(h.deps, actor, "r", "reject", { reason: "Решение" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
