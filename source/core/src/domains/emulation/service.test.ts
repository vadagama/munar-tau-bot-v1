import { beforeEach, describe, expect, it } from "vitest";

import { MemoryAdminRepo, MemoryAuditRepo, MemoryDb, MemoryEmulationRepo } from "../../testing/memory.ts";
import { makeTestActor } from "../../testing/actors.ts";
import { ScenarioRegistry, type BotScenarioContext } from "../../bot/registry.ts";
import type { Actor } from "../../pdp/types.ts";
import type { AssignmentListRecord, PersonRecord, ProfileRecord } from "../admin/port.ts";
import type { TestPersonRecord } from "./port.ts";
import {
  createTestPerson,
  endEmulation,
  resolveEffectiveActor,
  revokeTestPersonRole,
  simulate,
  startEmulation,
  type EmulationServiceDeps,
} from "./service.ts";

const T0 = new Date("2026-10-16T10:00:00Z");
const T1 = new Date("2026-10-16T10:05:00Z");

function seedProfile(
  admin: MemoryAdminRepo,
  input: { profileId: string; personId: string; isTest?: boolean },
): void {
  admin.persons.set(input.personId, {
    id: input.personId,
    fullName: `Персона ${input.personId}`,
    phoneE164: "+79990000000",
    status: "active",
    isTest: input.isTest ?? false,
    comment: null,
  });
  admin.profiles.set(input.profileId, {
    id: input.profileId,
    personId: input.personId,
    telegramUserId: "100",
    supabaseUserId: null,
    language: "ru",
    isTest: input.isTest ?? false,
    archivedAt: null,
  });
}

describe("createTestPerson (HLD 10.8)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let emulationDeps: EmulationServiceDeps;
  let tech: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    const emulation = new MemoryEmulationRepo();
    audit = new MemoryAuditRepo();
    emulationDeps = { admin, emulation, audit, tx: new MemoryDb() };
    tech = makeTestActor("tech_admin", []);
  });

  it("создаёт тестовую персону с синтетическими telegram и телефоном", async () => {
    const record = await createTestPerson(emulationDeps, tech, { fullName: "Тест Персона" });
    expect(record.person.isTest).toBe(true);
    expect(record.profile.isTest).toBe(true);
    expect(record.person.phoneE164).toMatch(/^\+7\d{11}$/);
    const telegram = Number(record.profile.telegramUserId);
    expect(telegram).toBeLessThan(0);
    expect(record.profile.supabaseUserId).toBeNull();

    const entry = audit.entries[0]!;
    expect(entry.action).toBe("emulation.person.create");
    expect(entry.entityType).toBe("person");
    expect(entry.entityId).toBe(record.person.id);
    expect(entry.after).toMatchObject({ is_test: true });
  });

  it("два создания — разные синтетические идентификаторы", async () => {
    const first = await createTestPerson(emulationDeps, tech, { fullName: "Первая" });
    const second = await createTestPerson(emulationDeps, tech, { fullName: "Вторая" });
    expect(first.person.phoneE164).not.toBe(second.person.phoneE164);
    expect(first.profile.telegramUserId).not.toBe(second.profile.telegramUserId);
  });

  it("пустое имя — VALIDATION_FAILED", async () => {
    await expect(createTestPerson(emulationDeps, tech, { fullName: "   " })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("startEmulation (HLD 10.8)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let emulation: MemoryEmulationRepo;
  let deps: EmulationServiceDeps;
  let tech: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    emulation = new MemoryEmulationRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, emulation, audit, tx: new MemoryDb() };
    tech = makeTestActor("tech_admin", []);
  });

  function registerTestPerson(record: TestPersonRecord): void {
    admin.persons.set(record.person.id, record.person);
    admin.profiles.set(record.profile.id, record.profile);
  }

  it("эмуляция не-тестового профиля — FORBIDDEN", async () => {
    seedProfile(admin, { profileId: "real-prof", personId: "real-person" });
    await expect(
      startEmulation(deps, tech, { emulatedProfileId: "real-prof" }, T0),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("эмуляция собственного профиля — VALIDATION_FAILED", async () => {
    seedProfile(admin, { profileId: tech.profile.id, personId: tech.person.id });
    await expect(
      startEmulation(deps, tech, { emulatedProfileId: tech.profile.id }, T0),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("несуществующий профиль — NOT_FOUND", async () => {
    await expect(
      startEmulation(deps, tech, { emulatedProfileId: "нет" }, T0),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("новый сеанс завершает прежний активный — активный один", async () => {
    const first = await createTestPerson(deps, tech, { fullName: "Первая" });
    const second = await createTestPerson(deps, tech, { fullName: "Вторая" });
    registerTestPerson(first);
    registerTestPerson(second);

    const s1 = await startEmulation(deps, tech, { emulatedProfileId: first.profile.id }, T0);
    const s2 = await startEmulation(deps, tech, { emulatedProfileId: second.profile.id }, T1);

    expect(s1.state).toBe("active");
    expect(s2.state).toBe("active");
    const active = await emulation.getActiveSessionByTechProfile(new MemoryDb(), tech.profile.id);
    expect(active?.id).toBe(s2.id);
    expect((await emulation.getSession(new MemoryDb(), s1.id))?.state).toBe("ended");
  });

  it("старт и завершение пишутся в журнал", async () => {
    const persona = await createTestPerson(deps, tech, { fullName: "Журналируемая" });
    registerTestPerson(persona);
    const session = await startEmulation(deps, tech, { emulatedProfileId: persona.profile.id }, T0);
    await endEmulation(deps, tech, session.id, T1);

    expect(audit.entries.map((entry) => entry.action)).toEqual([
      "emulation.person.create",
      "emulation.session.start",
      "emulation.session.end",
    ]);
    const startEntry = audit.entries[1]!;
    expect(startEntry.entityId).toBe(session.id);
    expect(startEntry.after).toMatchObject({ emulated_profile_id: persona.profile.id });
  });
});

describe("endEmulation", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let emulation: MemoryEmulationRepo;
  let deps: EmulationServiceDeps;
  let tech: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    emulation = new MemoryEmulationRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, emulation, audit, tx: new MemoryDb() };
    tech = makeTestActor("tech_admin", []);
  });

  it("чужой сеанс эмуляции — NOT_FOUND (не раскрываем существование)", async () => {
    const otherTech = makeTestActor("tech_admin", []);
    seedProfile(admin, { profileId: otherTech.profile.id, personId: otherTech.person.id, isTest: true });
    const session = await emulation.startSession(
      new MemoryDb(),
      { techAdminProfileId: otherTech.profile.id, emulatedProfileId: "кто-то" },
      T0,
    );
    await expect(endEmulation(deps, tech, session.id, T0)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("повторное завершение — INVALID_TRANSITION", async () => {
    const persona = await createTestPerson(deps, tech, { fullName: "Повторная" });
    admin.persons.set(persona.person.id, persona.person);
    admin.profiles.set(persona.profile.id, persona.profile);
    const session = await startEmulation(deps, tech, { emulatedProfileId: persona.profile.id }, T0);
    await endEmulation(deps, tech, session.id, T0);
    await expect(endEmulation(deps, tech, session.id, T0)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

describe("resolveEffectiveActor (HLD 10.8)", () => {
  let admin: MemoryAdminRepo;
  let emulation: MemoryEmulationRepo;
  let tech: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    emulation = new MemoryEmulationRepo();
    tech = makeTestActor("tech_admin", []);
  });

  it("без активного сеанса — Actor техадминистратора", async () => {
    const effective = await resolveEffectiveActor({ admin, emulation }, new MemoryDb(), tech, T0);
    expect(effective).toBe(tech);
  });

  it("с активным сеансом — Actor эмулируемой персоны с пометкой эмуляции", async () => {
    const persona = makeTestActor("executor", [], { isTest: true });
    seedProfile(admin, { profileId: persona.profile.id, personId: persona.person.id, isTest: true });
    const session = await emulation.startSession(
      new MemoryDb(),
      { techAdminProfileId: tech.profile.id, emulatedProfileId: persona.profile.id },
      T0,
    );
    const effective = await resolveEffectiveActor({ admin, emulation }, new MemoryDb(), tech, T0);
    expect(effective).not.toBe(tech);
    expect(effective.person.id).toBe(persona.person.id);
    expect(effective.emulation).toEqual({
      sessionId: session.id,
      realPersonId: tech.person.id,
      realProfileId: tech.profile.id,
    });
  });
});

describe("simulate (LLD-03 §3.16, критерий среза)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let emulation: MemoryEmulationRepo;
  let deps: EmulationServiceDeps;
  let tech: Actor;
  let registry: ScenarioRegistry;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    emulation = new MemoryEmulationRepo();
    audit = new MemoryAuditRepo();
    deps = { admin, emulation, audit, tx: new MemoryDb() };
    tech = makeTestActor("tech_admin", []);
    registry = new ScenarioRegistry();
  });

  async function emulatedPersonaActor(): Promise<{ actor: Actor; sessionId: string; personaId: string }> {
    const persona = await createTestPerson(deps, tech, { fullName: "Симулируемая" });
    admin.persons.set(persona.person.id, persona.person);
    admin.profiles.set(persona.profile.id, persona.profile);
    const session = await startEmulation(deps, tech, { emulatedProfileId: persona.profile.id }, T0);
    const actor = await resolveEffectiveActor({ admin, emulation }, new MemoryDb(), tech, T0);
    return { actor, sessionId: session.id, personaId: persona.person.id };
  }

  it("без режима эмуляции — VALIDATION_FAILED", async () => {
    await expect(
      simulate({ ...deps, scenarios: registry }, tech, { scenarioId: "любой" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("неизвестный сценарий — NOT_FOUND (в VS-1 реестр пуст)", async () => {
    const { actor } = await emulatedPersonaActor();
    await expect(
      simulate({ ...deps, scenarios: registry }, actor, { scenarioId: "нет-сценария" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("шаг сценария исполняется под персоной, журнал — реальный актор и персона", async () => {
    let seenContext: BotScenarioContext | null = null;
    registry.register({
      id: "echo",
      description: "Эхо для проверки симулятора",
      run: async (input, ctx) => {
        seenContext = ctx;
        return `эхо: ${input}`;
      },
    });

    const { actor, sessionId, personaId } = await emulatedPersonaActor();
    const result = await simulate(
      { ...deps, scenarios: registry },
      actor,
      { scenarioId: "echo", text: "привет" },
    );
    expect(result.reply).toBe("эхо: привет");
    expect(seenContext).toMatchObject({
      profileId: actor.profile.id,
      personId: personaId,
      fullName: "Симулируемая",
    });

    const entry = audit.entries[audit.entries.length - 1]!;
    expect(entry.action).toBe("emulation.simulate");
    expect(entry.actorPersonId).toBe(tech.person.id); // реальный актор (AUD-01)
    expect(entry.emulatedPersonId).toBe(personaId); // эмулируемая персона
    expect(entry.emulationSessionId).toBe(sessionId);
    expect(entry.meta).toMatchObject({ scenario: "echo" });
  });
  it("/register выходит из выбора помещения и возвращает кнопки регистрации", async () => {
    const buttons = [[{ text: "Русский", data: "ru" }]];
    registry.register({ id: "requests", description: "REQ", run: async () => "Выберите номер из списка. /objects" });
    registry.register({ id: "registration", description: "REG", run: async () => ({ text: "Выберите язык", buttons }) });
    const { actor } = await emulatedPersonaActor();
    const result = await simulate({ ...deps, scenarios: registry }, actor, { scenarioId: "requests", text: "/register" });
    expect(result).toEqual({ scenarioId: "registration", reply: "Выберите язык", buttons });
    expect(audit.entries.at(-1)?.meta).toMatchObject({ scenario: "registration" });
  });
  it("сохраняет worker-контекст уведомлений и отправляет общие команды визитов в задания",async()=>{
    registry.register({id:'tasks',description:'WRK',run:async(_input,ctx)=>String(ctx.bot)});
    registry.register({id:'notifications',description:'NTF',run:async(_input,ctx)=>String(ctx.bot)});
    const {actor}=await emulatedPersonaActor();
    expect(await simulate({...deps,scenarios:registry},actor,{scenarioId:'tasks',text:'/taskvisits З-1'})).toMatchObject({scenarioId:'tasks',bot:'worker',reply:'worker'});
    expect(await simulate({...deps,scenarios:registry},actor,{scenarioId:'tasks',text:'/notifications'})).toMatchObject({scenarioId:'notifications',bot:'worker',reply:'worker'});
    expect(await simulate({...deps,scenarios:registry},actor,{scenarioId:'notifications',bot:'worker',text:'/notifications publication'})).toMatchObject({bot:'worker',reply:'worker'});
  });
  it("сохраняет кнопки общего сценария вместе с текстом", async () => {
    const buttons = [[{ text: "Русский", data: "ru" }]];
    registry.register({ id: "keyboard", description: "Кнопки", run: async () => ({ text: "Язык", buttons }) });
    const { actor } = await emulatedPersonaActor();
    const result = await simulate({ ...deps, scenarios: registry }, actor, { scenarioId: "keyboard" });
    expect(result).toEqual({ scenarioId: "keyboard", reply: "Язык", buttons });
  });

});

describe("revokeTestPersonRole (снятие роли тестовой персоны)", () => {
  let admin: MemoryAdminRepo;
  let audit: MemoryAuditRepo;
  let db: MemoryDb;
  let deps: EmulationServiceDeps;
  let tech: Actor;

  beforeEach(() => {
    admin = new MemoryAdminRepo();
    audit = new MemoryAuditRepo();
    db = new MemoryDb();
    deps = { admin, emulation: new MemoryEmulationRepo(), audit, tx: db };
    tech = makeTestActor("tech_admin", []);
  });

  function seedPerson(input: {
    personId?: string;
    isTest?: boolean;
    status?: PersonRecord["status"];
  }): string {
    const personId = input.personId ?? "p-persona";
    const isTest = input.isTest ?? true;
    const person: PersonRecord = {
      id: personId,
      fullName: "Тестовая Персона",
      phoneE164: "+700000000001",
      status: input.status ?? "active",
      isTest,
      comment: null,
    };
    const profile: ProfileRecord = {
      id: `prof-${personId}`,
      personId,
      telegramUserId: "-1",
      supabaseUserId: null,
      language: "ru",
      isTest,
      archivedAt: null,
    };
    admin.persons.set(personId, person);
    admin.profiles.set(profile.id, profile);
    return personId;
  }

  function seedAssignment(input: { id: string; personId: string; role: AssignmentListRecord["role"] }): void {
    admin.assignments.set(input.id, {
      id: input.id,
      personId: input.personId,
      personFullName: admin.persons.get(input.personId)?.fullName ?? "",
      role: input.role,
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      status: "active",
      validFrom: null,
      validUntil: null,
      scopeBuildingIds: [],
      assignedBy: null,
      revokedBy: null,
      createdAt: T0.toISOString(),
    });
    admin.scopes.set(input.id, []);
  }

  function seedSession(profileId: string): void {
    admin.sessions.set(`s-${profileId}`, {
      id: `s-${profileId}`,
      profileId,
      startedAt: T0.toISOString(),
      lastActivityAt: T0.toISOString(),
      lastActivityKind: "start",
      revokedAt: null,
      revokedReason: null,
    });
  }

  it("техадмин снимает роль: назначение отозвано, сеанс закрыт, аудит и уведомление", async () => {
    const personId = seedPerson({});
    seedAssignment({ id: "a-1", personId, role: "administrator" });
    seedSession(`prof-${personId}`);

    const revoked = await revokeTestPersonRole(deps, tech, "a-1", "Проверка снятия");

    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedBy).toBe(tech.person.id);
    expect(admin.sessions.get(`s-prof-${personId}`)?.revokedAt).not.toBeNull();

    const entry = audit.entries[0]!;
    expect(entry.action).toBe("emulation.person.role.revoke");
    expect(entry.entityType).toBe("staff_assignment");
    expect(entry.entityId).toBe("a-1");
    expect(entry.reason).toBe("Проверка снятия");
    expect(entry.before).toEqual({ roles: ["administrator"] });
    expect(entry.after).toEqual({ roles: [] });
    expect(db.outbox).toHaveLength(1); // уведомление о смене ролей в outbox
  });

  it("при нескольких ролях снимается точечно, сеансы закрываются как в staff-форме", async () => {
    const personId = seedPerson({});
    seedAssignment({ id: "a-1", personId, role: "administrator" });
    seedAssignment({ id: "a-2", personId, role: "executor" });
    seedSession(`prof-${personId}`);

    const revoked = await revokeTestPersonRole(deps, tech, "a-1", "Сняли администратора");

    expect(revoked.status).toBe("revoked");
    expect(admin.assignments.get("a-2")?.status).toBe("active");
    // Удаление любой роли сокращает набор полномочий — сеанс закрывается
    // (консистентно с saveStaffRoles: removed → revokeSessionsForPerson).
    expect(admin.sessions.get(`s-prof-${personId}`)?.revokedAt).not.toBeNull();
    const entry = audit.entries[0]!;
    const rolesOf = (value: unknown) => (value as { roles: string[] }).roles;
    expect(rolesOf(entry.before).sort()).toEqual(["administrator", "executor"]);
    expect(rolesOf(entry.after)).toEqual(["executor"]);
  });

  it("не-тестовая персона — FORBIDDEN", async () => {
    const personId = seedPerson({ isTest: false });
    seedAssignment({ id: "a-real", personId, role: "administrator" });
    await expect(revokeTestPersonRole(deps, tech, "a-real", "Причина")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(admin.assignments.get("a-real")?.status).toBe("active");
  });

  it("неактивная персона — INVALID_TRANSITION", async () => {
    const personId = seedPerson({ status: "archived" });
    seedAssignment({ id: "a-arch", personId, role: "executor" });
    await expect(revokeTestPersonRole(deps, tech, "a-arch", "Причина")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("повторный отзыв — INVALID_TRANSITION", async () => {
    const personId = seedPerson({});
    seedAssignment({ id: "a-twice", personId, role: "executor" });
    await revokeTestPersonRole(deps, tech, "a-twice", "Первый раз");
    await expect(revokeTestPersonRole(deps, tech, "a-twice", "Второй раз")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("несуществующее назначение — NOT_FOUND", async () => {
    await expect(revokeTestPersonRole(deps, tech, "нет", "Причина")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("пустая причина — VALIDATION_FAILED", async () => {
    const personId = seedPerson({});
    seedAssignment({ id: "a-1", personId, role: "executor" });
    await expect(revokeTestPersonRole(deps, tech, "a-1", "   ")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(admin.assignments.get("a-1")?.status).toBe("active");
  });

  it("отзыв под эмуляцией — FORBIDDEN (защита в глубину)", async () => {
    const personId = seedPerson({});
    seedAssignment({ id: "a-1", personId, role: "executor" });
    const emulated: Actor = {
      ...tech,
      emulation: { sessionId: "s-emu", realPersonId: tech.person.id, realProfileId: tech.profile.id },
    };
    await expect(revokeTestPersonRole(deps, emulated, "a-1", "Причина")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(admin.assignments.get("a-1")?.status).toBe("active");
  });
});
