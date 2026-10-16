// Интеграционные тесты SqlAuditRepo на реальном PostgreSQL: append + чтение
// с фильтром области видимости (AUD-02) и курсорной пагинацией (HLD §19).

import { expect, it } from "vitest";

import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import type { AuditEntryInput, AuditVisibility } from "../../src/domains/audit/port.ts";

const entry = (scope: string[]): AuditEntryInput => ({
  actorPersonId: SEED.chairmanPersonId,
  actorProfileId: null,
  emulationSessionId: null,
  emulatedPersonId: null,
  action: "admin.assignment.create",
  entityType: "staff_assignment",
  entityId: "55555555-5555-5555-5555-555555555101",
  before: null,
  after: { role: "executor" },
  reason: "интеграционный тест",
  scopeBuildings: scope,
  meta: {},
});

const chairmanVisibility: AuditVisibility = {
  allBuildings: true,
  technicalActions: false,
  scopeBuildingIds: [],
};

describeWithDb("SqlAuditRepo на реальной БД", (getDb) => {
  const repo = new SqlAuditRepo();

  it("append назначает id/at; видимость AUD-02 фильтруется по области", async () => {
    const db = getDb();
    const appended = await repo.append(db, entry([SEED.building1]));
    expect(appended.id).toBeGreaterThan(0);
    expect(appended.at).toBeTruthy();
    expect(appended.scopeBuildings).toEqual([SEED.building1]);

    await repo.append(db, entry([SEED.building1]));
    await repo.append(db, entry([SEED.building2]));

    // Председатель видит всё
    const all = await repo.list(db, { limit: 10 }, chairmanVisibility);
    expect(all.entries).toHaveLength(3);

    // Администратор дома 1 — только записи своего дома (scope_buildings ⊆ область)
    const house1 = await repo.list(db, { limit: 10 }, {
      allBuildings: false,
      technicalActions: false,
      scopeBuildingIds: [SEED.building1],
    });
    expect(house1.entries).toHaveLength(2);

    // Посторонняя область — ничего
    const house3 = await repo.list(db, { limit: 10 }, {
      allBuildings: false,
      technicalActions: false,
      scopeBuildingIds: [SEED.building3],
    });
    expect(house3.entries).toHaveLength(0);

    // Пустая область (не председатель) — ничего
    const none = await repo.list(db, { limit: 10 }, {
      allBuildings: false,
      technicalActions: false,
      scopeBuildingIds: [],
    });
    expect(none.entries).toHaveLength(0);
  });

  it("курсорная пагинация: limit → nextCursor → остаток без дублей (AUD-02)", async () => {
    const db = getDb();
    for (let i = 0; i < 3; i++) {
      await repo.append(db, entry([SEED.building1]));
    }

    const first = await repo.list(db, { limit: 2 }, chairmanVisibility);
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await repo.list(db, { limit: 2, cursor: first.nextCursor ?? "" }, chairmanVisibility);
    expect(second.entries).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.entries, ...second.entries].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
  });
});
