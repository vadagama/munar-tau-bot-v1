import { beforeEach, describe, expect, it } from "vitest";

import { MemoryAdminRepo, MemoryAuditRepo, MemoryDb } from "../../testing/memory.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
import type { Actor } from "../../pdp/types.ts";
import type { NewAssignmentInput } from "./port.ts";
import {
  createAssignment,
  revokeAccessSessionById,
  revokeAssignment,
  updateAssignment,
  type AdminServiceDeps,
} from "./service.ts";

const T0 = new Date("2026-10-16T10:00:00Z");

function seedPersonWithProfile(
  admin: MemoryAdminRepo,
  input: { personId: string; profileId: string; fullName: string; isTest?: boolean },
): void {
  admin.persons.set(input.personId, {
    id: input.personId,
    fullName: input.fullName,
    phoneE164: "+79990000000",
    status: "active",
    isTest: input.isTest ?? false,
    comment: null,
  });
  admin.profiles.set(input.profileId, {
    id: input.profileId,
    personId: input.personId,
    telegramUserId: "100",
    supabaseUserId: null,
    language: "ru",
    isTest: input.isTest ?? false,
    archivedAt: null,
  });
}

describe("createAssignment (ROL-02)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let deps: AdminServiceDeps;
  let chairman: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, audit, tx: new MemoryDb() };
    chairman = makeTestActor("chairman", []);
  });

  it("создаёт назначение с областью и пишет запись в журнал", async () => {
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof1", fullName: "Исполнитель Тестов" });
    const input: NewAssignmentInput = {
      personId: "p1",
      role: "executor",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      validFrom: null,
      validUntil: null,
      scopeBuildingIds: [B1, B2],
      assignedByPersonId: chairman.person.id,
    };
    const created = await createAssignment(deps, chairman, input);
    expect(created.status).toBe("active");
    expect(created.role).toBe("executor");
    expect(created.personFullName).toBe("Исполнитель Тестов");
    expect(created.scopeBuildingIds).toEqual([B1, B2]);

    expect(audit.entries).toHaveLength(1);
    const entry = audit.entries[0]!;
    expect(entry.action).toBe("admin.assignment.create");
    expect(entry.entityType).toBe("staff_assignment");
    expect(entry.entityId).toBe(created.id);
    expect(entry.actorPersonId).toBe(chairman.person.id);
    expect(entry.after).toMatchObject({ role: "executor", scope_building_ids: [B1, B2] });
    expect(entry.scopeBuildings).toEqual([B1, B2]);
  });

  it("назначение несуществующей персоны — VALIDATION_FAILED", async () => {
    const input: NewAssignmentInput = {
      personId: "нет",
      role: "executor",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      validFrom: null,
      validUntil: null,
      scopeBuildingIds: [B1],
      assignedByPersonId: chairman.person.id,
    };
    await expect(createAssignment(deps, chairman, input)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("срок полномочий раньше начала — VALIDATION_FAILED (ROL-03)", async () => {
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof1", fullName: "Временный" });
    const input: NewAssignmentInput = {
      personId: "p1",
      role: "deputy",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      validFrom: "2026-10-16T00:00:00Z",
      validUntil: "2026-10-15T00:00:00Z",
      scopeBuildingIds: [B1],
      assignedByPersonId: chairman.person.id,
    };
    await expect(createAssignment(deps, chairman, input)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("revokeAssignment (ROL-04: отзыв роли отзывает сеансы)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let deps: AdminServiceDeps;
  let chairman: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, audit, tx: new MemoryDb() };
    chairman = makeTestActor("chairman", []);
  });

  it("отзыв назначению отзывает активные сеансы человека и пишет две записи", async () => {
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof1", fullName: "Увольняемый" });
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof2", fullName: "Увольняемый" });
    const assignmentId = await admin.insertAssignment(new MemoryDb(), {
      personId: "p1",
      role: "executor",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      validFrom: null,
      validUntil: null,
      scopeBuildingIds: [B1],
      assignedByPersonId: chairman.person.id,
    });
    await admin.ensureAccessSession(new MemoryDb(), "s1", "prof1", T0);
    await admin.ensureAccessSession(new MemoryDb(), "s2", "prof2", T0);
    await admin.ensureAccessSession(new MemoryDb(), "s3", "чужой", T0);

    const revoked = await revokeAssignment(deps, chairman, assignmentId, "Отзыв за прогул", T0);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedBy).toBe(chairman.person.id);

    // Оба сеанса человека отозваны, чужой сеанс не тронут (ROL-04).
    expect((await admin.getAccessSession(new MemoryDb(), "s1"))?.revokedAt).not.toBeNull();
    expect((await admin.getAccessSession(new MemoryDb(), "s2"))?.revokedAt).not.toBeNull();
    expect((await admin.getAccessSession(new MemoryDb(), "s3"))?.revokedAt).toBeNull();

    const actions = audit.entries.map((entry) => entry.action);
    expect(actions).toEqual(["admin.assignment.revoke", "admin.session.revoke"]);
    const assignmentEntry = audit.entries[0]!;
    expect(assignmentEntry.reason).toBe("Отзыв за прогул");
    expect(assignmentEntry.before).toMatchObject({ status: "active" });
    expect(assignmentEntry.after).toMatchObject({ status: "revoked" });
    const sessionEntry = audit.entries[1]!;
    expect(sessionEntry.entityId).toBeNull();
    expect(sessionEntry.meta).toMatchObject({ count: 2, person_id: "p1" });
  });

  it("повторный отзыв — INVALID_TRANSITION", async () => {
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof1", fullName: "Повтор" });
    const assignmentId = await admin.insertAssignment(new MemoryDb(), {
      personId: "p1",
      role: "duty",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      validFrom: null,
      validUntil: null,
      scopeBuildingIds: [],
      assignedByPersonId: chairman.person.id,
    });
    await revokeAssignment(deps, chairman, assignmentId, "Первый отзыв", T0);
    await expect(
      revokeAssignment(deps, chairman, assignmentId, "Повторный отзыв", T0),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("несуществующее назначение — NOT_FOUND", async () => {
    await expect(
      revokeAssignment(deps, chairman, "нет-такого", "Отзыв", T0),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateAssignment (ROL-02)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let deps: AdminServiceDeps;
  let chairman: Actor;
  let assignmentId: string;

  beforeEach(async () => {
    admin = new MemoryAdminRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, audit, tx: new MemoryDb() };
    chairman = makeTestActor("chairman", []);
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof1", fullName: "Правимый" });
    assignmentId = await admin.insertAssignment(new MemoryDb(), {
      personId: "p1",
      role: "administrator",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      validFrom: null,
      validUntil: null,
      scopeBuildingIds: [B1],
      assignedByPersonId: chairman.person.id,
    });
    await admin.replaceAssignmentScope(new MemoryDb(), assignmentId, [B1]);
  });

  it("правка спецправ и области — снимки до/после в журнале", async () => {
    const updated = await updateAssignment(
      deps,
      chairman,
      assignmentId,
      { financialRights: true, scopeBuildingIds: [B2] },
    );
    expect(updated.financialRights).toBe(true);
    expect(updated.scopeBuildingIds).toEqual([B2]);

    const entry = audit.entries[0]!;
    expect(entry.action).toBe("admin.assignment.update");
    expect(entry.before).toMatchObject({ financial_rights: false, scope_building_ids: [B1] });
    expect(entry.after).toMatchObject({ financial_rights: true, scope_building_ids: [B2] });
  });

  it("снятие срока (null) отличается от «не менять» (undefined)", async () => {
    await admin.updateAssignmentFields(new MemoryDb(), assignmentId, { validUntil: "2026-12-31T00:00:00Z" });
    const updated = await updateAssignment(deps, chairman, assignmentId, { validUntil: null });
    expect(updated.validUntil).toBeNull();
  });

  it("пустой патч — VALIDATION_FAILED", async () => {
    await expect(updateAssignment(deps, chairman, assignmentId, {})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("правка отозванного назначения — INVALID_TRANSITION", async () => {
    await admin.revokeAssignment(new MemoryDb(), assignmentId, chairman.person.id);
    await expect(
      updateAssignment(deps, chairman, assignmentId, { financialRights: true }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("revokeAccessSessionById (AUTH-06)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let deps: AdminServiceDeps;
  let tech: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, audit, tx: new MemoryDb() };
    tech = makeTestActor("tech_admin", []);
    seedPersonWithProfile(admin, { personId: "p1", profileId: "prof1", fullName: "Сеансный" });
  });

  it("отзывает активный сеанс и пишет запись в журнал", async () => {
    await admin.ensureAccessSession(new MemoryDb(), "s1", "prof1", T0);
    const revoked = await revokeAccessSessionById(deps, tech, "s1", "Выход по требованию", T0);
    expect(revoked.revokedAt).not.toBeNull();

    const entry = audit.entries[0]!;
    expect(entry.action).toBe("admin.session.revoke");
    expect(entry.entityId).toBe("s1");
    expect(entry.actorPersonId).toBe(tech.person.id);
  });

  it("уже отозванный сеанс — INVALID_TRANSITION", async () => {
    await admin.ensureAccessSession(new MemoryDb(), "s1", "prof1", T0);
    await revokeAccessSessionById(deps, tech, "s1", "Первый", T0);
    await expect(
      revokeAccessSessionById(deps, tech, "s1", "Повтор", T0),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("несуществующий сеанс — NOT_FOUND", async () => {
    await expect(
      revokeAccessSessionById(deps, tech, "нет", "Отзыв", T0),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
