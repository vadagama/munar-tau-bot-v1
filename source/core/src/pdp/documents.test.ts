import { describe, expect, it } from "vitest";
import { can } from "./evaluate.ts";
import type { Actor, ResourceRef, StaffRole } from "./types.ts";

function actor(role?: StaffRole): Actor {
  return {
    person: { id: "reader", fullName: "Тест", isTest: true, status: "active" },
    profile: { id: "profile", personId: "reader", language: "ru", isTest: true },
    emulation: null,
    assignments: role ? [{ id: "a", role, scopeBuildingIds: ["b1"], financialRights: false, registryExportRights: false, regulationsRights: false }] : [],
  };
}
const access = {
  buildingIds: ["b1"], isTest: true, audience: "resident" as "resident" | "owner" | "staff" | "finance" | "service",
  published: true, member: true, owner: false, sourceAllowed: true,
  sourceManageable: false, preparedById: "preparer", reviewerId: "reviewer",
  assignedTask: false, resultAuthorIds: [] as string[],
};
const resource = (patch: Partial<typeof access> = {}): ResourceRef => ({ documentAccess: { ...access, ...patch } });

describe("DOC-02/03: документ имеет собственную аудиторию и ограничения источника", () => {
  it("подтверждённый житель читает опубликованный общий документ", () => {
    expect(can(actor(), "document.read", resource()).allow).toBe(true);
    expect(can(actor(), "document.read", resource({ published: false })).allow).toBe(false);
    expect(can(actor(), "document.read", resource({ member: false })).allow).toBe(false);
  });
  it("собственническая аудитория не открывается арендатору", () => {
    expect(can(actor(), "document.read", resource({ audience: "owner" })).allow).toBe(false);
    expect(can(actor(), "document.read", resource({ audience: "owner", owner: true })).allow).toBe(true);
  });
  it("роль не обходит жалобу и test-контур", () => {
    expect(can(actor("chairman"), "document.read", resource({ sourceAllowed: false })).allow).toBe(false);
    expect(can(actor("chairman"), "document.read", resource({ isTest: false })).allow).toBe(false);
  });
  it("исполнитель видит служебный документ только своего задания", () => {
    expect(can(actor("executor"), "document.read", resource({ audience: "staff" })).allow).toBe(false);
    expect(can(actor("executor"), "document.read", resource({ audience: "staff", assignedTask: true })).allow).toBe(true);
    expect(can(actor(), "document.read", resource({ audience: "staff", assignedTask: true })).allow).toBe(false);
  });
  it("назначение не раскрывает финансовые материалы", () => {
    expect(can(actor("executor"), "document.read", resource({ audience: "finance", assignedTask: true })).allow).toBe(false);
    expect(can(actor("finance"), "document.read", resource({ audience: "finance" })).allow).toBe(true);
    expect(can(actor("tech_admin"), "document.read", resource({ audience: "staff" })).allow).toBe(false);
  });
  it("проверяет назначенный проверяющий с запретом собственной приёмки", () => {
    const r = resource({ reviewerId: "reader", audience: "staff" });
    expect(can(actor("doc_reviewer"), "document.review", r).allow).toBe(true);
    expect(can(actor("doc_reviewer"), "document.review", resource({ reviewerId: "reader", preparedById: "reader" })).allow).toBe(false);
    expect(can(actor("chairman"), "document.review", resource({ reviewerId: "reader", resultAuthorIds: ["reader"] })).allow).toBe(false);
    expect(can(actor("chairman"), "document.review", resource()).allow).toBe(false);
  });
  it("подготовитель после отзыва роли не меняет служебный документ", () => {
    const r = resource({ preparedById: "reader", assignedTask: true });
    expect(can(actor("executor"), "document.prepare", r).allow).toBe(true);
    expect(can(actor(), "document.prepare", r).allow).toBe(false);
    expect(can(actor("tech_admin"), "document.prepare", r).allow).toBe(false);
  });
  it("без ресурса и для архивной персоны действует запрет по умолчанию", () => {
    expect(can(actor("chairman"), "document.read").allow).toBe(false);
    const a = actor("chairman"); a.person.status = "archived";
    expect(can(a, "document.read", resource()).allow).toBe(false);
  });
});
