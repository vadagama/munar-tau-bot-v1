import { expect, it } from "vitest";
import {
  MemoryAdminRepo,
  MemoryAuditRepo,
  MemoryDb,
} from "../../testing/memory.ts";
import { saveStaffRoles, staffDetail } from "./staff.ts";
import { buildActorForProfile } from "./actor-service.ts";
import { noticeAllowed } from "../notifications/service.ts";
import { authorizeRoleChange } from "./staff-policy.ts";
class StaffTestDb extends MemoryDb {
  keys = new Map<string, { request_hash: string; response: unknown }>();
  override async query<T>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    if (sql.startsWith("insert into outbox(")) return super.query(sql, params);
    if (sql.startsWith("select request_hash,response")) {
      return (this.keys.has(String(params[0]))
        ? [this.keys.get(String(params[0]))]
        : []) as T[];
    }
    if (sql.startsWith("insert into idempotency_key")) {
      this.keys.set(String(params[0]), {
        request_hash: String(params[2]),
        response: params[3],
      });
    }
    return [];
  }
}
async function setup() {
  const admin = new MemoryAdminRepo(),
    db = new StaffTestDb(),
    audit = new MemoryAuditRepo();
  for (const id of ["chair", "worker"]) {
    admin.persons.set(id, {
      id,
      fullName: id,
      phoneE164: "+70000000000",
      status: "active",
      isTest: true,
      comment: null,
    });
    admin.profiles.set(`profile-${id}`, {
      id: `profile-${id}`,
      personId: id,
      telegramUserId: "-1",
      supabaseUserId: null,
      language: "ru",
      isTest: true,
      archivedAt: null,
    });
    await admin.insertAssignment(db, {
      personId: id,
      role: id === "chair" ? "chairman" : "executor",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      scopeBuildingIds: [],
      assignedByPersonId: "chair",
      validFrom: null,
      validUntil: null,
    });
  }
  const actor = await buildActorForProfile(
    admin,
    db,
    admin.profiles.get("profile-chair")!,
    new Date(),
  );
  const deps = { admin, db, audit };
  const card = await staffDetail(deps, actor, "worker");
  return { deps, actor, card, admin, db, audit };
}
it("замена ролей сохраняет историю, аудит и одно уведомление; повтор не дублирует", async () => {
  const h = await setup(),
    input = {
      roles: ["duty"],
      reason: "Дежурство",
      expected_version: h.card.version,
    };
  const saved = await saveStaffRoles(
    h.deps,
    h.actor,
    "worker",
    input,
    "change",
  );
  expect(saved.roles).toEqual(["duty"]);
  expect(await saveStaffRoles(h.deps, h.actor, "worker", input, "change"))
    .toEqual(saved);
  expect(
    [...h.admin.assignments.values()].filter((a) => a.personId === "worker"),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "executor", status: "revoked" }),
      expect.objectContaining({ role: "duty", status: "active" }),
    ]),
  );
  expect(h.audit.entries).toHaveLength(1);
  expect(h.audit.entries[0]).toMatchObject({
    action: "staff.roles.changed",
    reason: "Дежурство",
  });
  expect(h.db.outbox).toHaveLength(1);
  const notice = JSON.parse(String((h.db.outbox[0] as unknown[])[0]));
  expect(notice).toMatchObject({
    personId: "worker",
    audience: "personal",
    type: "staff.roles",
    bot: "worker",
    isTest: true,
    template: "notices.staff.roles_changed",
  });
});
it("снятие последней роли сохраняет профиль жителя и личную доставку уведомления", async () => {
  const h = await setup();
  await saveStaffRoles(h.deps, h.actor, "worker", {
    roles: [],
    reason: "Прекращение работы",
    expected_version: h.card.version,
  }, "remove");
  expect(h.admin.persons.get("worker")?.status).toBe("active");
  expect(h.admin.profiles.get("profile-worker")?.archivedAt).toBeNull();
  const recipient = await buildActorForProfile(
    h.admin,
    h.db,
    h.admin.profiles.get("profile-worker")!,
    new Date(),
  );
  expect(recipient.assignments).toHaveLength(0);
  expect(
    await noticeAllowed(h.db, recipient, {
      type: "staff.roles",
      audience: "personal",
      isTest: true,
    }),
  ).toBe(true);
  expect(h.db.outbox).toHaveLength(1);
});
it("устаревшая версия и незарегистрированный пользователь не меняют роли и не создают уведомления", async () => {
  const h = await setup();
  await expect(
    saveStaffRoles(h.deps, h.actor, "worker", {
      roles: ["duty"],
      reason: "Правка",
      expected_version: "stale",
    }, "stale"),
  ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
  h.admin.profiles.delete("profile-worker");
  await expect(
    saveStaffRoles(h.deps, h.actor, "worker", {
      roles: ["duty"],
      reason: "Правка",
      expected_version: h.card.version,
    }, "unregistered"),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(h.audit.entries).toHaveLength(0);
  expect(h.db.outbox).toHaveLength(0);
});
it("повторно проверяет полномочия инициатора и запрещает самоповышение/системные роли", async () => {
  const h = await setup();
  expect(() =>
    authorizeRoleChange(h.actor, "chair", ["chairman"], ["administrator"])
  ).toThrow();
  expect(() =>
    authorizeRoleChange(h.actor, "worker", ["executor"], ["tech_admin"])
  ).toThrow();
  for (const row of h.admin.assignments.values()) {
    if (row.personId === "chair") row.status = "revoked";
  }
  await expect(
    saveStaffRoles(h.deps, h.actor, "worker", {
      roles: ["duty"],
      reason: "Правка",
      expected_version: h.card.version,
    }, "revoked"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(h.db.outbox).toHaveLength(0);
});

it("архивная персона не читает каталог сотрудника по сохранённой роли",async()=>{
 const h=await setup();
 await expect(staffDetail(h.deps,{...h.actor,person:{...h.actor.person,status:"archived"}},"worker")).rejects.toMatchObject({code:"FORBIDDEN"});
});
