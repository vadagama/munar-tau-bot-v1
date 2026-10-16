// Интеграционные тесты SqlAdminRepo на реальном PostgreSQL: назначения (ROL-02),
// область (staff_scope), служебные сеансы (AUTH-06), каскадный отзыв (ROL-04),
// транзакционность DbClient (HLD §19: интеграционные).

import { expect, it } from "vitest";

import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import type { NewAssignmentInput } from "../../src/domains/admin/port.ts";

// access_session.id — uuid (миграция 0003): фиксированные UUID вместо строк-маркеров.
const TEST_SESSION_1 = "55555555-5555-5555-5555-555555555501";
const TEST_SESSION_2 = "55555555-5555-5555-5555-555555555502";

const administratorAssignment = (): NewAssignmentInput => ({
  personId: SEED.testAdminPersonId,
  role: "administrator",
  financialRights: false,
  registryExportRights: true,
  regulationsRights: false,
  validFrom: null,
  validUntil: null,
  scopeBuildingIds: [SEED.building1],
  assignedByPersonId: SEED.chairmanPersonId,
});

describeWithDb("SqlAdminRepo на реальной БД", (getDb) => {
  const repo = new SqlAdminRepo();

  it("listPersonsLookup находит тестовую персону сида по телефону (IMP-05)", async () => {
    const found = await repo.listPersonsLookup(getDb(), "+700000000001", 10);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      fullName: "Тест: администратор",
      isTest: true,
    });
  });

  it("назначение: создание, область, список, правка, отзыв (ROL-02)", async () => {
    const db = getDb();

    const id = await repo.insertAssignment(db, administratorAssignment());
    await repo.replaceAssignmentScope(db, id, [SEED.building1, SEED.building2]);

    const created = await repo.getAssignment(db, id);
    expect(created).toMatchObject({
      role: "administrator",
      status: "active",
      scopeBuildingIds: [SEED.building1, SEED.building2],
      personId: SEED.testAdminPersonId,
      assignedBy: SEED.chairmanPersonId,
    });

    const active = await repo.listActiveAssignments(db, SEED.testAdminPersonId);
    expect(active.map((assignment) => assignment.id)).toContain(id);

    expect(await repo.updateAssignmentFields(db, id, { financialRights: true })).toBe(true);
    const updated = await repo.getAssignment(db, id);
    expect(updated?.financialRights).toBe(true);

    // Повторный отзыв запрещён (ROL-02d)
    expect(await repo.revokeAssignment(db, id, SEED.chairmanPersonId)).toBe(true);
    expect(await repo.revokeAssignment(db, id, SEED.chairmanPersonId)).toBe(false);
    const after = await repo.getAssignment(db, id);
    expect(after).toMatchObject({ status: "revoked", revokedBy: SEED.chairmanPersonId });
  });

  it("сеансы: идемпотентное создание, продление, отзыв, список (AUTH-06)", async () => {
    const db = getDb();
    const profileRows = await db.query<{ id: string }>(
      "select id from profile where telegram_user_id = $1",
      [SEED.testAdminTelegramId],
    );
    const profileId = profileRows[0]?.id;
    if (!profileId) throw new Error("Сид не создал профиль тестового администратора");

    const start = new Date("2026-10-16T10:00:00Z");
    const first = await repo.ensureAccessSession(db, TEST_SESSION_1, profileId, start);
    const second = await repo.ensureAccessSession(db, TEST_SESSION_1, profileId, start);
    expect(second.startedAt).toBe(first.startedAt);

    await repo.touchAccessSession(db, TEST_SESSION_1, "api", new Date("2026-10-16T10:05:00Z"));
    const touched = await repo.getAccessSession(db, TEST_SESSION_1);
    expect(touched?.lastActivityAt).toBe("2026-10-16T10:05:00.000Z");

    const revoked = await repo.revokeAccessSession(db, TEST_SESSION_1, "тест", start);
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await repo.revokeAccessSession(db, TEST_SESSION_1, "повтор", start)).toBeNull();

    const activeOnly = await repo.listAccessSessions(db, { activeOnly: true, limit: 50 });
    expect(activeOnly.map((session) => session.id)).not.toContain(TEST_SESSION_1);
    const all = await repo.listAccessSessions(db, { activeOnly: false, limit: 50 });
    expect(all.map((session) => session.id)).toContain(TEST_SESSION_1);
  });

  it("отзыв назначения отзывает сеансы персоны (ROL-04)", async () => {
    const db = getDb();
    const profileRows = await db.query<{ id: string }>(
      "select id from profile where telegram_user_id = $1",
      [SEED.testExecutorTelegramId],
    );
    const profileId = profileRows[0]?.id;
    if (!profileId) throw new Error("Сид не создал профиль тестового исполнителя");

    await repo.ensureAccessSession(db, TEST_SESSION_2, profileId, new Date());
    const revokedCount = await repo.revokeSessionsForPerson(
      db,
      SEED.testExecutorPersonId,
      "ROL-04",
      new Date(),
    );
    expect(revokedCount).toBe(1);
    const session = await repo.getAccessSession(db, TEST_SESSION_2);
    expect(session?.revokedReason).toBe("ROL-04");
  });

  it("транзакция откатывает составную операцию целиком (HLD §19)", async () => {
    const db = getDb();
    await expect(
      db.transaction(async (exec) => {
        await repo.insertAssignment(exec, administratorAssignment());
        throw new Error("принудительный откат");
      }),
    ).rejects.toThrow("принудительный откат");

    const left = await repo.listAssignments(db, { activeOnly: false, limit: 100 });
    expect(left.find((assignment) => assignment.personId === SEED.testAdminPersonId)).toBeUndefined();
  });
});
