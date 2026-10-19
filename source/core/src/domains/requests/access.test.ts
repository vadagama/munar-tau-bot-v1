import { describe, expect, it } from "vitest";
import { can } from "../../pdp/evaluate.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { validateLocation } from "./access.ts";
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

describe("адресные обращения без дома (REG-01, R2.2)", () => {
  const admin: Actor = {
    ...actor,
    assignments: [{
      id: "a",
      role: "administrator" as const,
      scopeBuildingIds: [],
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
    }],
  };
  const chairman: Actor = {
    ...actor,
    person: { ...actor.person, id: "chair" },
    profile: { ...actor.profile, personId: "chair", id: "profile-chair" },
    assignments: [{
      id: "c",
      role: "chairman" as const,
      scopeBuildingIds: [],
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
    }],
  };
  const addressRequest = (): ResourceRef => ({
    requestAccess: {
      ...resource.requestAccess!,
      buildingId: null,
    },
  });

  it("адресное обращение видит и обрабатывает администратор", () => {
    expect(can(admin, "request.read", addressRequest()).allow).toBe(true);
    expect(can(admin, "request.manage", addressRequest()).allow).toBe(true);
  });

  it("chairmanOnly-жалоба без дома — только председатель", () => {
    const r: ResourceRef = {
      requestAccess: {
        ...resource.requestAccess!,
        buildingId: null,
        chairmanOnly: true,
      },
    };
    expect(can(admin, "request.read", r).allow).toBe(false);
    expect(can(chairman, "request.read", r).allow).toBe(true);
  });

  it("жалоба на самого сотрудника без дома ему не раскрывается", () => {
    const r: ResourceRef = {
      requestAccess: {
        ...resource.requestAccess!,
        buildingId: null,
        complaintSubjectId: "owner",
      },
    };
    expect(can(admin, "request.internal", r).allow).toBe(false);
    expect(can(chairman, "request.internal", r).allow).toBe(true);
  });
});

describe("адресные обращения без привязки (REG-01)", () => {
  /** exec с профилем автора и без связей (как у жителя после одобрения анкеты-минимум). */
  function profileExec(): DbExecutor {
    return {
      query: <T>(sql: string): Promise<T[]> => {
        if (sql.startsWith("select 1 from profile pr join person"))
          return Promise.resolve([{ ok: 1 }] as T[]);
        return Promise.resolve([] as T[]);
      },
    };
  }
  function emptyExec(): DbExecutor {
    return { query: <T>(): Promise<T[]> => Promise.resolve([] as T[]) };
  }

  it("автор с действующим профилем и без связей создаёт адресное обращение", async () => {
    const loc = await validateLocation(
      profileExec(),
      actor,
      "owner",
      { location_text: "Дом 107/2, кв 40" },
    );
    expect(loc).toEqual({ buildingId: null, premisesId: null });
  });

  it("без профиля и связей адресное обращение запрещено", async () => {
    await expect(
      validateLocation(
        emptyExec(),
        actor,
        "owner",
        { location_text: "Дом 107/2, кв 40" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("привязанное помещение по-прежнему требует действующую связь заявителя", async () => {
    const boundExec: DbExecutor = {
      query: <T>(sql: string): Promise<T[]> => {
        if (sql.startsWith("select building_id,is_test from premises"))
          return Promise.resolve([{ building_id: "b1", is_test: true }] as T[]);
        return Promise.resolve([] as T[]);
      },
    };
    await expect(
      validateLocation(
        boundExec,
        actor,
        "owner",
        { premises_id: "p1" },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Нужна действующая подтверждённая связь заявителя",
    });
  });
});
