import { describe, expect, it } from "vitest";
import { can } from "../../pdp/evaluate.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
const actor: Actor = {
  person: { id: "owner", fullName: "Тест", isTest: true, status: "active" },
  profile: { id: "p", personId: "owner", isTest: true, language: "ru" },
  assignments: [],
  emulation: null,
};
const resource: ResourceRef = {
  requestAccess: {
    authorId: "tenant",
    buildingId: "b1",
    state: "new",
    isTest: true,
    participant: false,
    activeAuthor: true,
    complaintSubjectId: null,
  },
};
describe("VS-3 PDP SHR/MSG/CMP", () => {
  it("собственность не открывает обращение другого жителя", () =>
    expect(can(actor, "request.read", resource).allow).toBe(false));
  it("совместный участник читает и комментирует, не подтверждает и не видит внутреннее", () => {
    const r = {
      requestAccess: { ...resource.requestAccess!, participant: true },
    };
    expect(can(actor, "request.read", r).allow).toBe(true);
    expect(can(actor, "request.comment", r).allow).toBe(true);
    expect(can(actor, "request.author", r).allow).toBe(false);
    expect(can(actor, "request.internal", r).allow).toBe(false);
  });
  it("отзыв связи блокирует новую переписку, история автора остаётся", () => {
    const r = {
      requestAccess: {
        ...resource.requestAccess!,
        authorId: "owner",
        activeAuthor: false,
      },
    };
    expect(can(actor, "request.read", r).allow).toBe(true);
    expect(can(actor, "request.comment", r).allow).toBe(false);
  });
  it("обычная роль не открывает жалобу на самого сотрудника", () => {
    const staff = {
      ...actor,
      assignments: [{
        id: "a",
        role: "administrator" as const,
        scopeBuildingIds: ["b1"],
        financialRights: false,
        registryExportRights: false,
        regulationsRights: false,
      }],
    };
    expect(can(staff, "request.internal", resource).allow).toBe(true);
    expect(
      can(staff, "request.internal", {
        requestAccess: {
          ...resource.requestAccess!,
          complaintSubjectId: "owner",
        },
      }).allow,
    ).toBe(false);
    expect(
      can(staff, "request.read", {
        requestAccess: { ...resource.requestAccess!, buildingId: "b2" },
      }).allow,
    ).toBe(false);
    expect(
      can(staff, "request.read", {
        requestAccess: { ...resource.requestAccess!, state: "draft" },
      }).allow,
    ).toBe(false);
  });
  it("эмуляция не получает данные другого контура", () =>
    expect(
      can(actor, "request.read", {
        requestAccess: {
          ...resource.requestAccess!,
          authorId: "owner",
          isTest: false,
        },
      }).allow,
    ).toBe(false));
});
