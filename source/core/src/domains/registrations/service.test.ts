import { expect, it } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type {
  AuditEntry,
  AuditEntryInput,
  AuditRepo,
} from "../audit/port.ts";
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
type HarnessOptions = {
  /** Ошибка для insert into person (например, дубликат телефона 23505). */
  personInsertError?: unknown;
  /** Подмена append аудита; по умолчанию — отказ («не должен писать аудит успеха»). */
  auditAppend?: AuditRepo["append"];
};
function harness(registration: Row, options: HarnessOptions = {}) {
  const writes: string[] = [];
  const writeParams: unknown[][] = [];
  const exec: DbExecutor = {
    query: <T>(query: string, params?: readonly unknown[]) => {
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
      if (query.startsWith("insert into person")) {
        if (options.personInsertError)
          return Promise.reject(options.personInsertError);
        return Promise.resolve([{ id: "n1" }] as T[]);
      }
      writes.push(query);
      writeParams.push(params ? [...params] : []);
      return Promise.resolve([] as T[]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  const audit: AuditRepo = {
    append:
      options.auditAppend ??
      (() => Promise.reject(new Error("не должен писать аудит успеха"))),
    list: () => Promise.reject(new Error("unused")),
  };
  return { deps: { db, audit }, writes, writeParams };
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

const approveRegistration: Row = {
  telegram_user_id: 777,
  draft: {
    full_name: "Житель",
    phone_e164: "+77770000001",
    language: "ru",
    consent: true,
  },
};

it("подтверждение без основания оставляет decided_reason пустым и без «null» в уведомлении", async () => {
  const auditInputs: AuditEntryInput[] = [];
  const h = harness(approveRegistration, {
    auditAppend: (exec, input) => {
      void exec;
      auditInputs.push(input);
      const entry: AuditEntry = { ...input, id: 1, at: "2026-10-17T00:00:00Z" };
      return Promise.resolve(entry);
    },
  });
  const result = await reviewRegistration(h.deps, actor, "r", "approve", {});
  expect(result.state).toBe("approved");
  const stateUpdate = h.writes.findIndex((q) =>
    q.startsWith("update registration set state=$2"),
  );
  expect(stateUpdate).toBeGreaterThanOrEqual(0);
  expect(h.writeParams[stateUpdate]![4]).toBeNull();
  const notification = h.writes.findIndex((q) =>
    q.startsWith("insert into notification"),
  );
  expect(notification).toBeGreaterThanOrEqual(0);
  expect(String(h.writeParams[notification]![1])).not.toContain("null");
  expect(auditInputs).toHaveLength(1);
  expect(auditInputs[0]?.action).toBe("registration.approve");
  expect(auditInputs[0]?.reason).toBeNull();
});

it("дубликат телефона в реестре при подтверждении объясняет привязку карточки", async () => {
  const h = harness(approveRegistration, {
    personInsertError: { code: "23505" },
  });
  await expect(
    reviewRegistration(h.deps, actor, "r", "approve", {}),
  ).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
    message:
      "В реестре уже есть карточка с этим телефоном — обновите страницу и привяжите её",
  });
});

it("уточнение требует основание", async () => {
  const h = harness({});
  await expect(
    reviewRegistration(h.deps, actor, "r", "clarify", {}),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(h.writes).toHaveLength(0);
});

/** append, фиксирующий запись аудита как сохранённую (для успешных решений). */
const auditAppendOk: AuditRepo["append"] = (_exec, input) => {
  const entry: AuditEntry = { ...input, id: 1, at: "" };
  return Promise.resolve(entry);
};

it("уведомление об уточнении подсказывает заявку /fix", async () => {
  const h = harness({ telegram_user_id: 777 }, { auditAppend: auditAppendOk });
  await reviewRegistration(h.deps, actor, "r", "clarify", {
    reason: "Нужно имя",
  });
  const i = h.writes.findIndex((q) => q.startsWith("insert into notification"));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(String(h.writeParams[i]?.[1])).toContain("/fix");
});

it("уведомление о согласовании без уточнения не содержит /fix", async () => {
  const h = harness(
    {
      telegram_user_id: 777,
      draft: {
        full_name: "Житель",
        phone_e164: "+77771234567",
        language: "ru",
        consent: true,
      },
    },
    { auditAppend: auditAppendOk },
  );
  await reviewRegistration(h.deps, actor, "r", "approve", {
    reason: "Проверено",
  });
  const i = h.writes.findIndex((q) => q.startsWith("insert into notification"));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(String(h.writeParams[i]?.[1])).not.toContain("/fix");
});
