import { expect, it } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type {
  AuditEntry,
  AuditEntryInput,
  AuditRepo,
} from "../audit/port.ts";
import { reviewRegistration, submitRegistration } from "./service.ts";
import { sweepRegistrations } from "./jobs.ts";
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
  /** Карточка реестра для «select * from person where id=$1 for update». */
  matchedPerson?: Row;
  /** Существующие профили заявителя для «select * from profile … for update». */
  profiles?: Row[];
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
      if (query.startsWith("select * from person where id=$1 for update"))
        return Promise.resolve(
          (options.matchedPerson ? [options.matchedPerson] : []) as T[],
        );
      if (query.startsWith("select * from profile"))
        return Promise.resolve((options.profiles ?? []) as T[]);
      if (query.startsWith("insert into person")) {
        writes.push(query);
        writeParams.push(params ? [...params] : []);
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

/** Анкета-минимум (REG-01): без помещения и роли. */
const liteRegistration: Row = {
  telegram_user_id: 777,
  premises_id: null,
  role: null,
  draft: {
    full_name: "Житель",
    phone_e164: "+77770000001",
    language: "ru",
    consent: true,
  },
};

it("анкета без помещения: подтверждение создаёт профиль без связей", async () => {
  const auditInputs: AuditEntryInput[] = [];
  const h = harness(liteRegistration, {
    auditAppend: (_exec, input) => {
      auditInputs.push(input);
      return Promise.resolve({ ...input, id: 1, at: "" } as AuditEntry);
    },
  });
  const result = await reviewRegistration(h.deps, actor, "r", "approve", {});
  expect(result.state).toBe("approved");
  expect(h.writes.some((q) => q.startsWith("insert into person"))).toBe(true);
  expect(h.writes.some((q) => q.startsWith("insert into profile"))).toBe(true);
  expect(h.writes.some((q) => q.startsWith("insert into connection"))).toBe(
    false,
  );
  expect(h.writes.some((q) => q.startsWith("update connection"))).toBe(false);
  expect(
    h.writes.some((q) => q.startsWith("update registration set connection_id")),
  ).toBe(false);
  expect(auditInputs).toHaveLength(1);
  expect(auditInputs[0]?.action).toBe("registration.approve");
  expect(auditInputs[0]?.scopeBuildings).toEqual([]);
});

it("анкета без помещения: привязка к карточке реестра не требует связи с помещением", async () => {
  const h = harness({ ...liteRegistration, person_id: null }, {
    matchedPerson: { id: "n9", is_test: false },
    auditAppend: auditAppendOk,
  });
  const result = await reviewRegistration(h.deps, actor, "r", "approve", {
    person_id: "n9",
  });
  expect(result.state).toBe("approved");
  expect(result.person_id).toBe("n9");
  expect(h.writes.some((q) => q.startsWith("insert into person"))).toBe(false);
  expect(h.writes.some((q) => q.startsWith("insert into connection"))).toBe(
    false,
  );
});

it("анкета без помещения не оспаривается — нет связи для оспаривания", async () => {
  const h = harness({ ...liteRegistration, state: "approved" });
  await expect(
    reviewRegistration(h.deps, actor, "r", "dispute", { reason: "Спор" }),
  ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  expect(h.writes).toHaveLength(0);
});

const STAGE_PARAMS = {
  hours: 12,
  clock: "working",
  timezone: "Asia/Almaty",
  start: 8,
  end: 20,
};

/** Харнесс подачи анкеты: таймеры, регламент и список сотрудников замкнуты. */
function submitHarness(options: { reviewers?: string[] } = {}) {
  const writes: string[] = [];
  const writeParams: unknown[][] = [];
  const exec: DbExecutor = {
    query: <T>(query: string, params?: readonly unknown[]) => {
      if (query.startsWith("select distinct a.person_id from staff_assignment"))
        return Promise.resolve(
          (options.reviewers ?? []).map((person_id) => ({ person_id })) as T[],
        );
      if (query.startsWith("select v.id,v.params from time_rule_version"))
        return Promise.resolve([{ id: "v1", params: STAGE_PARAMS }] as T[]);
      if (query.startsWith("insert into timer")) {
        writes.push(query);
        writeParams.push(params ? [...params] : []);
        return Promise.resolve([{ due_at: "2026-10-20T10:00:00.000Z" }] as T[]);
      }
      if (query.startsWith("insert into registration")) {
        writes.push(query);
        writeParams.push(params ? [...params] : []);
        return Promise.resolve([{ id: "r1" }] as T[]);
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
    append: () => Promise.reject(new Error("не должен писать аудит успеха")),
    list: () => Promise.reject(new Error("unused")),
  };
  return { deps: { db, audit }, writes, writeParams };
}

it("анкета-минимум создаётся без помещения на этап администратора", async () => {
  const h = submitHarness({ reviewers: ["p-admin"] });
  const row = await submitRegistration(
    h.deps,
    null,
    {
      full_name: "Житель Тест",
      phone_e164: "+7 777 777 16 76",
      language: "ru",
      consent: true,
    },
    "777000001",
  );
  const i = h.writes.findIndex((q) => q.startsWith("insert into registration"));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(h.writeParams[i]![2]).toBeNull(); // premises_id
  expect(h.writeParams[i]![3]).toBeNull(); // role
  expect(h.writeParams[i]![6]).toBe("administrator"); // review_stage
  expect(row.stage_due_at).toBe("2026-10-20T10:00:00.000Z");
  expect(h.writes.some((q) => q.startsWith("insert into outbox"))).toBe(true);
});

it("подача от сотрудника без помещения отклоняется — анкеты сотрудников привязаны", async () => {
  const h = submitHarness();
  await expect(
    submitRegistration(h.deps, actor, {
      person_id: "someone",
      full_name: "Кто-то",
      phone_e164: "+77770000002",
      language: "ru",
      consent: true,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(h.writes).toHaveLength(0);
});

/** Харнесс эскалации: таймер этапа администратора и анкета без дома. */
function sweepHarness(options: { deputies?: string[] } = {}) {
  const writes: string[] = [];
  const writeParams: unknown[][] = [];
  const auditInputs: AuditEntryInput[] = [];
  const exec: DbExecutor = {
    query: <T>(query: string, params?: readonly unknown[]) => {
      if (query.startsWith("select t.*,v.params,r.key as rule_key from timer"))
        return Promise.resolve([
          {
            id: "t1",
            entity_id: "r1",
            stage: "administrator",
            due_at: "2026-10-19T10:00:00.000Z",
            state: "pending",
            rule_version_id: "v1",
            params: STAGE_PARAMS,
            rule_key: "registration_stage",
          },
        ] as T[]);
      if (
        query.startsWith(
          "select r.*,p.building_id,p.kind,p.number from registration",
        )
      )
        return Promise.resolve([
          {
            id: "r1",
            state: "pending_review",
            review_stage: "administrator",
            premises_id: null,
            building_id: null,
            kind: null,
            number: null,
            telegram_user_id: 777,
            is_test: false,
            total_due_at: null,
          },
        ] as T[]);
      if (query.startsWith("select distinct a.person_id from staff_assignment"))
        return Promise.resolve(
          (options.deputies ?? []).map((person_id) => ({ person_id })) as T[],
        );
      if (query.startsWith("select language from profile"))
        return Promise.resolve([] as T[]);
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
    append: (_exec, input) => {
      auditInputs.push(input);
      return Promise.resolve({ ...input, id: 1, at: "" } as AuditEntry);
    },
    list: () => Promise.reject(new Error("unused")),
  };
  return { deps: { db, audit }, writes, writeParams, auditInputs };
}

it("эскалация анкеты без помещения проходит без дома и без «null» в аудите", async () => {
  const h = sweepHarness();
  const processed = await sweepRegistrations(
    h.deps,
    new Date("2026-10-19T12:00:00Z"),
  );
  expect(processed).toBe(1);
  const i = h.writes.findIndex((q) =>
    q.startsWith("update registration set review_stage"),
  );
  expect(i).toBeGreaterThanOrEqual(0);
  expect(h.writeParams[i]![1]).toBe("chairman");
  expect(h.auditInputs).toHaveLength(1);
  expect(h.auditInputs[0]?.action).toBe("registration.timer");
  expect(h.auditInputs[0]?.scopeBuildings).toEqual([]);
});
