// Сценарные тесты PDP — таблица сценариев по разделу 7 матрицы прав
// (в части, входящей в VS-1) и требованиям AUTH-01/03, ROL-01–04.

import { describe, expect, it } from "vitest";

import { ACTIONS } from "./actions.ts";
import { buildActor, type AssignmentRow, SESSION_IDLE_LIMIT_MS, SESSION_TOTAL_LIMIT_MS } from "./actor.ts";
import { can } from "./evaluate.ts";
import type { Actor, ActorAssignment, ActorPerson, ActorProfile } from "./types.ts";

const NOW = new Date("2026-10-16T10:00:00Z");

const person = (overrides: Partial<ActorPerson> = {}): ActorPerson => ({
  id: "p1",
  fullName: "Тестовый Человек",
  status: "active",
  isTest: false,
  ...overrides,
});

const profile = (overrides: Partial<ActorProfile> = {}): ActorProfile => ({
  id: "pr1",
  personId: "p1",
  language: "ru",
  isTest: false,
  ...overrides,
});

const assignment = (overrides: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: "a1",
  role: "administrator",
  financialRights: false,
  registryExportRights: false,
  regulationsRights: false,
  status: "active",
  validFrom: null,
  validUntil: null,
  scopeBuildingIds: [],
  ...overrides,
});

function actorFrom(assignments: AssignmentRow[], options: { emulated?: boolean } = {}): Actor {
  const actor = buildActor(person(), profile(), assignments, NOW);
  if (options.emulated) {
    actor.emulation = { sessionId: "em1", realPersonId: "p-admin", realProfileId: "pr-admin" };
  }
  return actor;
}

function withRole(role: ActorAssignment["role"], scopeBuildingIds: string[] | undefined): AssignmentRow {
  return assignment({
    role,
    // undefined в задании теста = «строк нет» в БД
    scopeBuildingIds: scopeBuildingIds ?? [],
  });
}

describe("реестр действий", () => {
  it("все действия VS-1–VS-8 зарегистрированы", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([
      "admin.assignment.create",
      "admin.assignment.list",
      "admin.assignment.update",
      "admin.persons.lookup",
      "admin.session.list",
      "admin.session.revoke",
      "audit.read",
      "document.manage",
      "document.obligations",
      "document.prepare",
      "document.read",
      "document.review",
      "document.use",
      "emulation.person.create",
      "emulation.person.list",
      "emulation.person.role.revoke",
      "emulation.session.end",
      "emulation.session.start",
      "emulation.simulate",
      "incident.link", "incident.manage", "incident.read", "incident.use",
      "meta.dictionary",
      "meta.me",
      "notification.failures",
      "notification.preferences",
      "poll.answer", "poll.manage", "poll.read", "poll.results",
      "privacy.request",
      "publication.approve", "publication.manage", "publication.read",
      "registration.manage",
      "registration.review",
      "registration.self",
      "registry.export",
      "registry.read",
      "registry.rules.edit",
      "registry.rules.read",
      "registry.telegram.recovery",
      "registry.write",
      "request.author", "request.category.edit", "request.comment", "request.internal", "request.manage", "request.read", "request.use",
      "settings.templates.edit",
      "settings.templates.read",
      "staff.edit", "staff.read",
      "task.execute", "task.manage", "task.read", "task.use",
    ]);
  });
});

describe("AUTH-01: вход не выдаёт роль", () => {
  const nobody = actorFrom([]);

  it("meta/me доступен любому аутентифицированному с профилем", () => {
    expect(can(nobody, "meta.me")).toEqual({ allow: true });
    expect(can(nobody, "meta.dictionary")).toEqual({ allow: true });
  });

  it("журнал и управление недоступны без назначения", () => {
    expect(can(nobody, "audit.read")).toMatchObject({ allow: false });
    expect(can(nobody, "admin.assignment.create")).toMatchObject({ allow: false });
    expect(can(nobody, "emulation.person.create")).toMatchObject({ allow: false });
  });
});

describe("ROL-04: отзыв полномочий блокирует следующий запрос", () => {
  it("отозванное назначение не попадает в Actor", () => {
    const actor = actorFrom([assignment({ status: "revoked", scopeBuildingIds: ["b1"] })]);
    expect(actor.assignments).toHaveLength(0);
    expect(can(actor, "audit.read")).toMatchObject({ allow: false });
  });

  it("истёкшее временное полномочие (ROL-03) не попадает в Actor", () => {
    const expired = actorFrom([assignment({ validUntil: "2026-10-16T09:59:59Z", scopeBuildingIds: ["b1"] })]);
    expect(expired.assignments).toHaveLength(0);
    const active = actorFrom([assignment({ validUntil: "2026-10-16T10:00:01Z", scopeBuildingIds: ["b1"] })]);
    expect(active.assignments).toHaveLength(1);
  });

  it("полномочие, ещё не начавшееся, не попадает в Actor", () => {
    const future = actorFrom([assignment({ validFrom: "2026-10-16T10:00:01Z", scopeBuildingIds: ["b1"] })]);
    expect(future.assignments).toHaveLength(0);
  });
});

describe("ROL-02a: председатель действует по всему ОСИ", () => {
  const chairman = actorFrom([withRole("chairman", undefined)]);

  it("журнал и назначения — без назначения области", () => {
    expect(can(chairman, "audit.read")).toEqual({ allow: true });
    expect(can(chairman, "admin.assignment.list")).toEqual({ allow: true });
  });

  it("назначение администратора со спецправами и любой областью (ROL-02b)", () => {
    const decision = can(chairman, "admin.assignment.create", {
      targetRole: "administrator",
      targetSpecialRights: true,
      buildingIds: ["b1", "b2"],
    });
    expect(decision).toEqual({ allow: true });
  });

  it("назначение председателя/техадмина — допустимо без области (весь ОСИ)", () => {
    expect(can(chairman, "admin.assignment.create", { targetRole: "tech_admin" })).toEqual({ allow: true });
  });

  it("назначение исполнителя без области отклоняется — нужна явная область", () => {
    expect(can(chairman, "admin.assignment.create", { targetRole: "executor", buildingIds: [] }))
      .toMatchObject({ allow: false });
    expect(can(chairman, "admin.assignment.create", { targetRole: "executor", buildingIds: ["b1"] }))
      .toEqual({ allow: true });
  });
});

describe("ROL-02/02b/02c: администратор", () => {
  const admin = actorFrom([withRole("administrator", ["b1", "b2"])]);

  it("читает журнал (строки ограничит домен audit)", () => {
    expect(can(admin, "audit.read")).toEqual({ allow: true });
  });

  it("назначает исполнителя в своей области", () => {
    expect(can(admin, "admin.assignment.create", { targetRole: "executor", buildingIds: ["b1"] }))
      .toEqual({ allow: true });
  });

  it("не назначает вне своей области", () => {
    expect(can(admin, "admin.assignment.create", { targetRole: "executor", buildingIds: ["b3"] }))
      .toMatchObject({ allow: false, reason: "Область назначения выходит за пределы области администратора" });
  });

  it("не выдаёт спецправа (ROL-02b)", () => {
    expect(can(admin, "admin.assignment.create", {
      targetRole: "executor",
      targetSpecialRights: true,
      buildingIds: ["b1"],
    })).toMatchObject({ allow: false, reason: "Спецправа выдаёт только председатель (ROL-02b)" });
  });

  it("не назначает администраторов и председателя", () => {
    expect(can(admin, "admin.assignment.create", { targetRole: "administrator", buildingIds: ["b1"] }))
      .toMatchObject({ allow: false });
    expect(can(admin, "admin.assignment.create", { targetRole: "chairman", buildingIds: ["b1"] }))
      .toMatchObject({ allow: false });
  });

  it("заместитель — только временный (ROL-03)", () => {
    expect(can(admin, "admin.assignment.create", { targetRole: "deputy", buildingIds: ["b1"] }))
      .toMatchObject({ allow: false });
    expect(can(admin, "admin.assignment.create", {
      targetRole: "deputy",
      buildingIds: ["b1"],
      targetValidUntil: "2026-10-20T00:00:00Z",
    })).toEqual({ allow: true });
  });

  it("без области не назначает никого", () => {
    const scoped = actorFrom([withRole("administrator", [])]);
    expect(can(scoped, "admin.assignment.create", { targetRole: "executor", buildingIds: ["b1"] }))
      .toMatchObject({ allow: false });
  });
});

describe("техадмин и исполнитель", () => {
  const tech = actorFrom([withRole("tech_admin", undefined)]);
  const executor = actorFrom([withRole("executor", ["b1"])]);

  it("техадмин управляет эмуляцией и видит журнал (технические события)", () => {
    expect(can(tech, "emulation.person.create")).toEqual({ allow: true });
    expect(can(tech, "emulation.session.start")).toEqual({ allow: true });
    expect(can(tech, "audit.read")).toEqual({ allow: true });
  });

  it("техадмин не назначает роли (не ROL-02)", () => {
    expect(can(tech, "admin.assignment.create", { targetRole: "executor", buildingIds: ["b1"] }))
      .toMatchObject({ allow: false });
  });

  it("исполнитель не читает журнал", () => {
    expect(can(executor, "audit.read")).toMatchObject({ allow: false });
  });

  it("сотрудники не видят сеансы других, но завершают свой (AUTH-06)", () => {
    expect(can(executor, "admin.session.revoke", { profileId: "pr-other" })).toMatchObject({ allow: false });
    expect(can(executor, "admin.session.revoke", { profileId: "pr1" })).toEqual({ allow: true });
    expect(can(tech, "admin.session.revoke", { profileId: "pr-other" })).toEqual({ allow: true });
  });
});

describe("эмуляция (HLD 10.8)", () => {
  const emulatedAdmin = actorFrom([withRole("administrator", ["b1"])], { emulated: true });
  const emulatedTech = actorFrom([withRole("tech_admin", undefined)], { emulated: true });

  it("эмулируемая персона читает журнал по своим правам", () => {
    expect(can(emulatedAdmin, "audit.read")).toEqual({ allow: true });
  });

  it("эмулируемая персона видит meta/me", () => {
    expect(can(emulatedAdmin, "meta.me")).toEqual({ allow: true });
  });

  it("привилегированные действия в эмуляции недоступны", () => {
    expect(can(emulatedAdmin, "admin.assignment.create", { targetRole: "executor", buildingIds: ["b1"] }))
      .toMatchObject({ allow: false, reason: "Привилегированные действия в эмуляции недоступны" });
  });

  it("эмуляция не запускает эмуляцию и не управляет сеансами", () => {
    expect(can(emulatedTech, "emulation.session.start")).toMatchObject({ allow: false });
    expect(can(emulatedTech, "admin.session.revoke", { profileId: "pr1" })).toMatchObject({ allow: false });
  });
});

describe("неизвестное действие", () => {
  it("отклоняется (deny-by-default)", () => {
    const hacker = can(actorFrom([withRole("chairman", undefined)]), "unknown.action" as never);
    expect(hacker).toMatchObject({ allow: false });
  });
});

describe("пределы сеанса AUTH-06 — константы", () => {
  it("12 часов и 30 минут", () => {
    expect(SESSION_TOTAL_LIMIT_MS).toBe(12 * 3600 * 1000);
    expect(SESSION_IDLE_LIMIT_MS).toBe(30 * 60 * 1000);
  });
});

it("REG-02a: управление чужой анкетой privileged и запрещено в эмуляции", () => {
  const chairman = actorFrom([withRole("chairman", undefined)]);
  expect(can(chairman, "registration.manage").allow).toBe(true);
  const emulated = actorFrom([withRole("chairman", undefined)], { emulated: true });
  expect(can(emulated, "registration.manage").allow).toBe(false);
  expect(can(actorFrom([withRole("tech_admin", undefined)]), "registration.review").allow).toBe(true);
});
