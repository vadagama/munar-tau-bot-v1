// Сборка записи журнала от имени актора (AUD-01, HLD 10.8): под эмуляцией
// запись ссылается на реального актора (техадминистратора) и эмулируемую
// персону одновременно. Область действия — дома из вызова либо объединение
// областей действующих назначений актора (тег области чтения, AUD-02).

import type { Actor } from "../../pdp/types.ts";
import type { AuditActionInput, AuditEntryInput } from "./port.ts";

/** Объединение областей назначений актора; весь ОСИ (без области) не тегируется. */
export function collectScopeBuildings(actor: Actor): string[] {
  const buildings = new Set<string>();
  for (const assignment of actor.assignments) {
    for (const buildingId of assignment.scopeBuildingIds ?? []) {
      buildings.add(buildingId);
    }
  }
  return [...buildings];
}

/** Единая точка создания записей журнала для действий актора. */
export function buildAuditInput(actor: Actor, input: AuditActionInput): AuditEntryInput {
  const emulation = actor.emulation;
  const meta: Record<string, unknown> = { ...input.meta };
  if (emulation) {
    meta.emulated_profile_id = actor.profile.id;
  }
  return {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before,
    after: input.after,
    reason: input.reason ?? null,
    actorPersonId: emulation ? emulation.realPersonId : actor.person.id,
    actorProfileId: emulation ? emulation.realProfileId : actor.profile.id,
    emulationSessionId: emulation ? emulation.sessionId : null,
    emulatedPersonId: emulation ? actor.person.id : null,
    scopeBuildings: input.buildingIds ?? collectScopeBuildings(actor),
    meta,
  };
}
