import { describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api.ts";
import {
  auditVisibilityForActor,
  decodeAuditCursor,
  encodeAuditCursor,
  isVisibleEntry,
} from "./logic.ts";
import { B1, B2, B3, makeTestActor } from "../../testing/actors.ts";

describe("auditVisibilityForActor", () => {
  it("председатель видит весь журнал", () => {
    const visibility = auditVisibilityForActor(makeTestActor("chairman", []));
    expect(visibility).toEqual({
      allBuildings: true,
      technicalActions: false,
      scopeBuildingIds: [],
    });
  });

  it("администратор — область своих назначений", () => {
    const visibility = auditVisibilityForActor(makeTestActor("administrator", [B1, B2]));
    expect(visibility).toEqual({
      allBuildings: false,
      technicalActions: false,
      scopeBuildingIds: [B1, B2],
    });
  });

  it("администратор с несколькими назначениями — объединение областей", () => {
    const actor = makeTestActor("administrator", [B1]);
    actor.assignments.push({
      id: "a2",
      role: "administrator",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      scopeBuildingIds: [B2],
    });
    const visibility = auditVisibilityForActor(actor);
    expect(visibility.scopeBuildingIds).toEqual([B1, B2]);
  });

  it("техадмин — технические события", () => {
    const visibility = auditVisibilityForActor(makeTestActor("tech_admin", []));
    expect(visibility).toEqual({
      allBuildings: false,
      technicalActions: true,
      scopeBuildingIds: [],
    });
  });

  it("администратор и техадмин одновременно — объединение правил", () => {
    const actor = makeTestActor("administrator", [B1]);
    actor.assignments.push({
      id: "a2",
      role: "tech_admin",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      scopeBuildingIds: [],
    });
    const visibility = auditVisibilityForActor(actor);
    expect(visibility.technicalActions).toBe(true);
    expect(visibility.scopeBuildingIds).toEqual([B1]);
  });

  it("администратор с пустой областью — роль допущена, домов не видно", () => {
    const visibility = auditVisibilityForActor(makeTestActor("administrator", []));
    expect(visibility.allBuildings).toBe(false);
    expect(visibility.technicalActions).toBe(false);
    expect(visibility.scopeBuildingIds).toEqual([]);
  });

  it.each(["executor", "duty", "finance", "deputy", "doc_reviewer"] as const)(
    "%s журнал не читает — отказ (защита в глубину)",
    (role) => {
      try {
        auditVisibilityForActor(makeTestActor(role, [B1]));
        expect.unreachable("ожидали FORBIDDEN");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("FORBIDDEN");
      }
    },
  );
});

describe("isVisibleEntry", () => {
  it.each([
    ["председатель видит всё", { allBuildings: true, technicalActions: false, scopeBuildingIds: [] }, "admin.assignment.create", [] as string[], true],
    ["председатель видит технические", { allBuildings: true, technicalActions: false, scopeBuildingIds: [] }, "tech.outbox.deliver", [], true],
    ["техадмин видит технические", { allBuildings: false, technicalActions: true, scopeBuildingIds: [] }, "tech.outbox.deliver", [], true],
    ["техадмин не видит обычные", { allBuildings: false, technicalActions: true, scopeBuildingIds: [] }, "admin.assignment.create", [], false],
    ["администратор видит запись своего дома", { allBuildings: false, technicalActions: false, scopeBuildingIds: [B1, B2] }, "admin.assignment.create", [B1], true],
    ["администратор не видит чужие дома", { allBuildings: false, technicalActions: false, scopeBuildingIds: [B1] }, "admin.assignment.create", [B3], false],
    ["администратор не видит запись за пределами области", { allBuildings: false, technicalActions: false, scopeBuildingIds: [B1] }, "admin.assignment.create", [B1, B3], false],
    ["администратор не видит записи без области", { allBuildings: false, technicalActions: false, scopeBuildingIds: [B1] }, "admin.assignment.create", [], false],
    ["пустая область — ничего не видно", { allBuildings: false, technicalActions: false, scopeBuildingIds: [] }, "admin.assignment.create", [B1], false],
  ])("%s", (_name, visibility, action, scopeBuildings, expected) => {
    expect(isVisibleEntry({ action, scopeBuildings }, visibility)).toBe(expected);
  });
});

describe("курсор страниц журнала", () => {
  it("кодирование и разбор туда-обратно", () => {
    const cursor = encodeAuditCursor({ at: "2026-10-16T12:00:00.000Z", id: 42 });
    expect(decodeAuditCursor(cursor)).toEqual({ at: "2026-10-16T12:00:00.000Z", id: 42 });
  });

  it.each(["мусор", "aaaa", "", "2026-10-16T12:00:00.000Z|abc", "2026-10-16T12:00:00.000Z|"])(
    "некорректный курсор %j — VALIDATION_FAILED",
    (cursor) => {
      expect(() => decodeAuditCursor(cursor)).toThrowError(ApiError);
      try {
        decodeAuditCursor(cursor);
      } catch (error) {
        expect((error as ApiError).code).toBe("VALIDATION_FAILED");
      }
    },
  );
});
