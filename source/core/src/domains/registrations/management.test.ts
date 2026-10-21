import { describe, expect, it } from "vitest";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { Actor, StaffRole } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { manageRegistration } from "./management.ts";

function actor(role?: StaffRole, personId = "manager"): Actor {
  return {
    person: { id: personId, fullName: "Пользователь", status: "active", isTest: false },
    profile: { id: `profile-${personId}`, personId, language: "ru", isTest: false },
    assignments: role ? [{
      id: `assignment-${role}`, role, scopeBuildingIds: undefined,
      financialRights: false, registryExportRights: false, regulationsRights: false,
    }] : [],
    emulation: null,
  };
}

function harness(options: { registration?: Row; targetRoles?: StaffRole[] } = {}) {
  let currentActor: Actor | undefined;
  const registration: Row = {
    id: "r1", person_id: "resident", telegram_user_id: "100", premises_id: null,
    role: null, state: "approved", review_stage: "administrator", version: 3,
    is_test: false, total_due_at: null,
    draft: { full_name: "Прежнее имя", phone_e164: "+77771234567", language: "ru", consent: true },
    ...options.registration,
  };
  const writes: { sql: string; params: unknown[] }[] = [];
  const audit: Row[] = [];
  const idempotency = new Map<string, Row>();
  const exec: DbExecutor = {
    query: <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized.startsWith("select request_hash,response from idempotency_key")) {
        const value = idempotency.get(`${params[0]}:${params[1]}`);
        return Promise.resolve((value ? [value] : []) as T[]);
      }
      if (normalized.startsWith("insert into idempotency_key")) {
        idempotency.set(`${params[0]}:${params[1]}`, { request_hash: params[2], response: params[3] });
        return Promise.resolve([]);
      }
      if (normalized.startsWith("select") && /\bfrom registration\b/.test(normalized)) {
        return Promise.resolve([{ ...registration }] as T[]);
      }
      if (normalized.startsWith("select") && /\bfrom staff_assignment\b/.test(normalized)) {
        const roles = currentActor && params[0] === currentActor.person.id
          ? currentActor.assignments.map((assignment) => assignment.role)
          : options.targetRoles ?? [];
        return Promise.resolve(roles.map((role) => ({
          id: `target-${role}`, person_id: params[0], role, status: "active",
          valid_from: "2026-01-01T00:00:00Z", valid_until: null, revoked_at: null,
        })) as T[]);
      }
      if (normalized.startsWith("select") && /\bfrom person\b/.test(normalized)) {
        return Promise.resolve([{
          id: params[0], is_test: currentActor && params[0] === currentActor.person.id ? currentActor.person.isTest : registration.is_test, status: "active",
          full_name: "Прежнее имя", phone_e164: "+77771234567",
        }] as T[]);
      }
      if (normalized.startsWith("select") && /\bfrom profile\b/.test(normalized)) {
        if (normalized.includes("is_test<>$2")) return Promise.resolve([]);
        return Promise.resolve([{
          id: currentActor?.profile.id ?? "profile-resident", person_id: currentActor?.person.id ?? "resident", telegram_user_id: "100",
          language: "ru", is_test: registration.is_test, archived_at: null,
        }] as T[]);
      }
      if (normalized.startsWith("select v.id,v.params from time_rule_version")) {
        return Promise.resolve([{ id: "time-v1", params: { hours: 12, clock: "calendar" } }] as T[]);
      }
      if (normalized.startsWith("insert into timer")) {
        writes.push({ sql, params: [...params] });
        return Promise.resolve([{ due_at: "2026-10-22T10:00:00Z" }] as T[]);
      }
      if (/^(update|insert|delete)\b/.test(normalized)) {
        writes.push({ sql, params: [...params] });
        return Promise.resolve(normalized.includes("returning") ? [{ ...registration, version: 4 }] as T[] : []);
      }
      return Promise.resolve([]);
    },
  };
  const db: DbClient = { ...exec, transaction: (fn) => fn(exec), close: () => Promise.resolve() };
  const deps = {
    db,
    audit: { append: (_exec: DbExecutor, entry: Row) => { audit.push(entry); return Promise.resolve(); } },
  } as unknown as RegistryDeps;
  return { deps, writes, audit,
    run: (caller: Actor, id: string, input: Row, key: string) => {
      currentActor = caller;
      return manageRegistration(deps, caller, id, input, key);
    },
  };
}

const edit = {
  operation: "edit" as const, expected_version: 3, reason: "Исправление имени",
  full_name: "Новое имя", phone_e164: "+77779876543", language: "kk",
};
const remove = { operation: "delete" as const, expected_version: 3, reason: "Удаление по заявлению" };

describe("REG: управление основной анкетой", () => {
  it("житель не исправляет чужую анкету", async () => {
    const h = harness();
    await expect(h.run(actor(undefined, "another"), "r1", edit, "edit-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.writes).toHaveLength(0);
  });

  it.each(["executor", "duty", "finance", "doc_reviewer"] as StaffRole[])("роль %s не управляет чужой анкетой", async (role) => {
    const h = harness();
    await expect(h.run(actor(role), "r1", edit, "edit-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.writes).toHaveLength(0);
  });

  it("другой контур is_test скрыт даже от председателя", async () => {
    const h = harness({ registration: { is_test: true } });
    await expect(h.run(actor("chairman"), "r1", edit, "edit-1"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.writes).toHaveLength(0);
  });

  it("устаревшая версия не сохраняет исправление", async () => {
    const h = harness();
    await expect(h.run(actor("administrator"), "r1", { ...edit, expected_version: 2 }, "edit-1"))
      .rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    expect(h.writes).toHaveLength(0);
  });

  it.each(["chairman", "tech_admin"] as StaffRole[])("нельзя удалить анкету с защищённой ролью %s", async (role) => {
    const h = harness({ targetRoles: [role] });
    await expect(h.run(actor("chairman"), "r1", remove, "delete-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.writes).toHaveLength(0);
  });

  it.each([
    ["administrator", "administrator"],
    ["deputy", "administrator"],
    ["deputy", "deputy"],
  ] as [StaffRole, StaffRole][])("%s не удаляет сотрудника %s своего уровня или выше", async (managerRole, targetRole) => {
    const h = harness({ targetRoles: [targetRole] });
    await expect(h.run(actor(managerRole), "r1", remove, "delete-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.writes).toHaveLength(0);
  });

  it.each([undefined, "administrator", "deputy", "chairman", "tech_admin"] as (StaffRole | undefined)[])("исправление approved: %s сохраняет предложение без изменения действующих person/profile", async (role) => {
    const h = harness();
    const caller = role ? actor(role) : actor(undefined, "resident");
    await h.run(caller, "r1", edit, "edit-1");
    const updates = h.writes.filter(({ sql }) => /^update registration\b/i.test(sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toContain("r1");
    expect(updates[0]!.params.some((param) => typeof param === "string" && param.includes("Новое имя"))).toBe(true);
    expect(h.writes.some(({ sql }) => /^(update|delete from) (person|profile|connection|staff_assignment|access_session)\b/i.test(sql))).toBe(false);
    expect(h.writes.some(({ sql }) => /^insert into registration\b/i.test(sql))).toBe(false);
    expect(h.audit).toHaveLength(1);
  });

  it.each([
    [undefined, undefined],
    ["administrator", "deputy"],
    ["deputy", "executor"],
    ["tech_admin", "administrator"],
  ] as [StaffRole | undefined, StaffRole | undefined][])("удаление %s → %s закрывает доступ, сохраняя историю", async (managerRole, targetRole) => {
    const h = harness({ targetRoles: targetRole ? [targetRole] : [] });
    const caller = managerRole ? actor(managerRole) : actor(undefined, "resident");
    await h.run(caller, "r1", remove, "delete-1");
    for (const table of ["registration", "profile", "connection", "staff_assignment", "access_session"]) {
      expect(h.writes.some(({ sql }) => new RegExp(`^update ${table}\\b`, "i").test(sql))).toBe(true);
    }
    expect(h.writes.some(({ sql }) => /^delete from (request|request_message|audit_event|person)\b/i.test(sql))).toBe(false);
    expect(h.audit).toHaveLength(1);
  });

  it("повтор одного исправления не создаёт второе изменение или аудит", async () => {
    const h = harness();
    const caller = actor(undefined, "resident");
    const first = await h.run(caller, "r1", edit, "edit-1");
    const writes = h.writes.length;
    const second = await h.run(caller, "r1", edit, "edit-1");
    expect(second).toEqual(first);
    expect(h.writes).toHaveLength(writes);
    expect(h.audit).toHaveLength(1);
  });
});
