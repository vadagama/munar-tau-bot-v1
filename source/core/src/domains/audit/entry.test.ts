import { describe, expect, it } from "vitest";

import { buildAuditInput, collectScopeBuildings } from "./entry.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";

describe("collectScopeBuildings", () => {
  it("объединяет области действующих назначений", () => {
    const actor = makeTestActor("administrator", [B1]);
    actor.assignments.push({
      id: "a2",
      role: "administrator",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      scopeBuildingIds: [B2, B1],
    });
    expect(collectScopeBuildings(actor)).toEqual([B1, B2]);
  });

  it("весь ОСИ (без области) не тегирует дома", () => {
    const actor = makeTestActor("chairman", []);
    expect(collectScopeBuildings(actor)).toEqual([]);
  });
});

describe("buildAuditInput", () => {
  it("без эмуляции — актор записи совпадает с актором действия", () => {
    const actor = makeTestActor("administrator", [B1, B2]);
    const input = buildAuditInput(actor, {
      action: "admin.assignment.create",
      entityType: "staff_assignment",
      entityId: "a-1",
      after: { role: "executor" },
      reason: "Новый сотрудник",
      buildingIds: [B1],
    });
    expect(input.actorPersonId).toBe(actor.person.id);
    expect(input.actorProfileId).toBe(actor.profile.id);
    expect(input.emulationSessionId).toBeNull();
    expect(input.emulatedPersonId).toBeNull();
    expect(input.entityId).toBe("a-1");
    expect(input.reason).toBe("Новый сотрудник");
    expect(input.scopeBuildings).toEqual([B1]);
    expect(input.meta).toEqual({});
  });

  it("без указанных домов — область назначений актора (тег AUD-02)", () => {
    const actor = makeTestActor("administrator", [B2, B1]);
    const input = buildAuditInput(actor, { action: "audit.read", entityType: "audit" });
    expect(input.scopeBuildings).toEqual([B2, B1]);
  });

  it("под эмуляцией — реальный актор и эмулируемая персона (AUD-01, критерий среза)", () => {
    const tech = makeTestActor("tech_admin", []);
    const persona = makeTestActor("executor", [B1], { isTest: true });
    persona.emulation = {
      sessionId: "em-1",
      realPersonId: tech.person.id,
      realProfileId: tech.profile.id,
    };
    const input = buildAuditInput(persona, {
      action: "audit.read",
      entityType: "audit",
      meta: { source: "cabinet" },
    });
    expect(input.actorPersonId).toBe(tech.person.id);
    expect(input.actorProfileId).toBe(tech.profile.id);
    expect(input.emulationSessionId).toBe("em-1");
    expect(input.emulatedPersonId).toBe(persona.person.id);
    expect(input.meta).toEqual({
      source: "cabinet",
      emulated_profile_id: persona.profile.id,
    });
    // Область действия — из назначений эмулируемой персоны.
    expect(input.scopeBuildings).toEqual([B1]);
  });
});
