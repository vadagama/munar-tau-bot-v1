import { beforeEach, describe, expect, it } from "vitest";

import { MemoryAdminRepo, MemoryAuditRepo, MemoryDb, MemoryEmulationRepo } from "../../testing/memory.ts";
import { makeTestActor } from "../../testing/actors.ts";
import { ScenarioRegistry, type BotScenarioContext } from "../../bot/registry.ts";
import type { Actor } from "../../pdp/types.ts";
import type { TestPersonRecord } from "./port.ts";
import {
  createTestPerson,
  endEmulation,
  resolveEffectiveActor,
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
  it("сохраняет кнопки общего сценария вместе с текстом", async () => {
    const buttons = [[{ text: "Русский", data: "ru" }]];
    registry.register({ id: "keyboard", description: "Кнопки", run: async () => ({ text: "Язык", buttons }) });
    const { actor } = await emulatedPersonaActor();
    const result = await simulate({ ...deps, scenarios: registry }, actor, { scenarioId: "keyboard" });
    expect(result).toEqual({ scenarioId: "keyboard", reply: "Язык", buttons });
  });

});
