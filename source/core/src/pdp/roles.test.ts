import { expect, it } from "vitest";
import { canManageRole, effectiveRoles, withRoleHierarchy } from "./roles.ts";
import { B1, B2, makeTestActor } from "../testing/actors.ts";
import { can } from "./evaluate.ts";
it("старшие наследуют деловые роли, системные роли не наследуются", () => {
  expect(effectiveRoles(["deputy"])).toEqual(
    expect.arrayContaining(["executor", "duty", "doc_reviewer", "finance"]),
  );
  expect(effectiveRoles(["chairman"])).toEqual(
    expect.arrayContaining(["administrator", "deputy", "executor"]),
  );
  expect(effectiveRoles(["tech_admin"])).toEqual(["tech_admin"]);
  expect(effectiveRoles(["administrator"])).not.toContain("chairman");
});
it("управление только вниз; системные роли не назначаются обычной формой", () => {
  expect(canManageRole(["administrator"], "deputy")).toBe(true);
  expect(canManageRole(["deputy"], "finance")).toBe(true);
  expect(canManageRole(["administrator"], "administrator")).toBe(false);
  expect(canManageRole(["chairman"], "tech_admin")).toBe(false);
  expect(canManageRole(["chairman"], "chairman")).toBe(false);
});
it("полномочия действуют по всему ОСИ; явные роли сохраняются отдельно", () => {
  const actor = withRoleHierarchy(
    makeTestActor("administrator", [B1], { isTest: true }),
    [B1, B2],
  );
  expect(actor.assignedRoles).toEqual(["administrator"]);
  expect(
    can(actor, "task.manage", {
      taskAccess: { buildingIds: [B2], assigneeId: null, isTest: true },
    }).allow,
  ).toBe(true);
  expect(can(actor, "registry.export").allow).toBe(true);
  expect(actor.assignments.find((a) => a.role === "finance")?.financialRights)
    .toBe(true);
});

it("старые специальные флаги не расширяют младшую деловую роль", () => {
  const base = makeTestActor("executor", [B1]);
  base.assignments[0]!.financialRights = true;
  base.assignments[0]!.registryExportRights = true;
  const actor = withRoleHierarchy(base, [B1, B2]);
  expect(actor.assignments[0]!.financialRights).toBe(false);
  expect(actor.assignments[0]!.registryExportRights).toBe(false);
});
