// Сценарные тесты конвейера VS-1 (план, Task 5): вход/отзыв/эмуляция
// (AUTH-01, ROL-04, AUTH-06), NO_PROFILE, PDP-отказы в журнал (AUD-01),
// эмулированное чтение журнала с реальным актором и персоной (критерий среза),
// CORS/no-store. БД — in-memory фейки ядра.

import { assertEquals, assertExists } from "@std/assert";

import { buildJwtKeys } from "../../core/src/auth/jwt.ts";
import { createTestJwtKeyPair } from "../../core/src/testing/sign-jwt.ts";
import {
  MemoryAdminRepo,
  MemoryAuditRepo,
  MemoryDb,
  MemoryEmulationRepo,
} from "../../core/src/testing/memory.ts";
import { B1, B2, assignmentRow, makeTestActor } from "../../core/src/testing/actors.ts";
import { buildActor } from "../../core/src/pdp/actor.ts";
import type { Actor } from "../../core/src/pdp/types.ts";
import type { PersonRecord, ProfileRecord } from "../../core/src/domains/admin/port.ts";
import { revokeAssignment } from "../../core/src/domains/admin/service.ts";
import type { TestPersonRecord } from "../../core/src/domains/emulation/port.ts";
import { ScenarioRegistry } from "../../core/src/bot/registry.ts";
import { handle, handleWithDeps, type ApiDeps } from "./index.ts";
import { matchRoute } from "./handlers.ts";

const T0 = "2026-10-16T10:00:00.000Z";

// Ключи подписи и их JWKS — один раз на модуль (top-level await в Deno).
const PRIMARY = await createTestJwtKeyPair("test-key-1");
const FOREIGN = await createTestJwtKeyPair("foreign-key");
const JWT_KEYS = await buildJwtKeys(PRIMARY.jwksJson());

/** Свежая активность: сеансы фикстур живы относительно реального времени. */
const NOW_ISO = () => new Date().toISOString();

function makeDeps(): { deps: ApiDeps; admin: MemoryAdminRepo; audit: MemoryAuditRepo; emulation: MemoryEmulationRepo } {
  const admin = new MemoryAdminRepo();
  const audit = new MemoryAuditRepo();
  const emulation = new MemoryEmulationRepo();
  const deps: ApiDeps = {
    jwtKeys: JWT_KEYS,
    cabinetOrigin: undefined,
    db: new MemoryDb(),
    admin,
    audit,
    emulation,
    scenarios: new ScenarioRegistry(),
  };
  return { deps, admin, audit, emulation };
}

function seedIdentity(
  admin: MemoryAdminRepo,
  input: {
    sub: string;
    sessionId: string;
    personId: string;
    profileId: string;
    actor: Actor;
    isTest?: boolean;
  },
): void {
  const person: PersonRecord = {
    id: input.personId,
    fullName: input.actor.person.fullName,
    phoneE164: "+79990000000",
    status: "active",
    isTest: input.isTest ?? false,
    comment: null,
  };
  const profile: ProfileRecord = {
    id: input.profileId,
    personId: input.personId,
    telegramUserId: "100",
    supabaseUserId: input.sub,
    language: "ru",
    isTest: input.isTest ?? false,
    archivedAt: null,
  };
  admin.persons.set(person.id, person);
  admin.profiles.set(profile.id, profile);
  // Назначения из Actor переносятся в фейк как активные строки.
  for (const assignment of input.actor.assignments) {
    const record = {
      ...assignment,
      personId: input.personId,
      personFullName: person.fullName,
      validFrom: null,
      validUntil: null,
      assignedBy: null,
      revokedBy: null,
      createdAt: T0,
      status: "active" as const,
      scopeBuildingIds: [...(assignment.scopeBuildingIds ?? [])],
    };
    admin.assignments.set(assignment.id, record);
    // Область фейк хранит отдельно (как staff_scope в БД).
    admin.scopes.set(assignment.id, [...(assignment.scopeBuildingIds ?? [])]);
  }
  admin.sessions.set(input.sessionId, {
    id: input.sessionId,
    profileId: input.profileId,
    startedAt: NOW_ISO(),
    lastActivityAt: NOW_ISO(),
    lastActivityKind: "start",
    revokedAt: null,
    revokedReason: null,
  });
}

function token(input: {
  sub: string;
  sessionId: string;
  /** true — подписать чужим ключом (не из JWKS deps). */
  foreign?: boolean;
  exp?: number;
}): Promise<string> {
  return (input.foreign ?? false ? FOREIGN : PRIMARY).sign(
    { sub: input.sub, session_id: input.sessionId, exp: input.exp ?? 4102444800 },
  );
}

interface CallOptions {
  token?: string;
  body?: Record<string, unknown>;
  origin?: string;
  method?: string;
}

function call(
  deps: ApiDeps,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers["authorization"] = `Bearer ${options.token}`;
  if (options.origin !== undefined) headers["origin"] = options.origin;
  const request = new Request(`https://example.functions${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : {
      body: JSON.stringify(options.body),
      headers: { ...headers, "content-type": "application/json" },
    }),
  });
  return handleWithDeps(request, deps);
}

// ── Аутентификация (AUTH-01, NO_PROFILE) ───────────────────────────────────

Deno.test("GET /v1/meta/health — 200 без аутентификации", async () => {
  const { deps } = makeDeps();
  const response = await handleWithDeps(
    new Request("https://example.functions/v1/meta/health"),
    deps,
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ok");
});

Deno.test("без токена — 401 UNAUTHENTICATED в формате LLD-03 §1.1", async () => {
  const { deps } = makeDeps();
  const response = await call(deps, "/v1/meta/me");
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(typeof body.error.trace_id, "string");
});

Deno.test("поддельная подпись токена — 401 UNAUTHENTICATED", async () => {
  const { deps } = makeDeps();
  const forged = await token({ sub: "00000000-0000-0000-0000-000000000001", sessionId: "s1", foreign: true });
  const response = await call(deps, "/v1/meta/me", { token: forged });
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHENTICATED");
});

Deno.test("истёкший токен — 401 UNAUTHENTICATED", async () => {
  const { deps } = makeDeps();
  const expired = await token({ sub: "00000000-0000-0000-0000-000000000001", sessionId: "s1", exp: 1000 });
  const response = await call(deps, "/v1/meta/me", { token: expired });
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHENTICATED");
});

Deno.test("токен без session_id — 401 UNAUTHENTICATED", async () => {
  const { deps } = makeDeps();
  const noSession = await PRIMARY.sign({ sub: "00000000-0000-0000-0000-000000000001" });
  const response = await call(deps, "/v1/meta/me", { token: noSession });
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHENTICATED");
});

Deno.test("неизвестный sub — 401 NO_PROFILE: вход не выдаёт роль", async () => {
  const { deps } = makeDeps();
  const unknown = await token({ sub: "00000000-0000-0000-0000-000000000099", sessionId: "s1" });
  const response = await call(deps, "/v1/meta/me", { token: unknown });
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "NO_PROFILE");
});

// ── meta/me ────────────────────────────────────────────────────────────────

Deno.test("meta/me председателя — роли, null-область (весь ОСИ), пределы сеанса", async () => {
  const { deps, admin } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-chair", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-chair" });

  const response = await call(deps, "/v1/meta/me", { token: jwt });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assertEquals(body.person.id, "p-chair");
  assertEquals(body.assignments[0].role, "chairman");
  assertEquals(body.assignments[0].scope_building_ids, null);
  assertEquals(body.session.total_limit_seconds, 43200);
  assertEquals(body.session.idle_limit_seconds, 1800);
  assertEquals(body.emulation, null);
});

Deno.test("meta/me сотрудника без назначений — 200, ролей нет (вход не выдаёт роль)", async () => {
  const { deps, admin } = makeDeps();
  const bare = buildActor(
    { id: "p-bare", fullName: "Без Роли", status: "active", isTest: false },
    { id: "prof-bare", personId: "p-bare", language: "ru", isTest: false },
    [],
    new Date(),
  );
  seedIdentity(admin, { sub: "sub-bare", sessionId: "s-bare", personId: "p-bare", profileId: "prof-bare", actor: bare });
  const jwt = await token({ sub: "sub-bare", sessionId: "s-bare" });

  const response = await call(deps, "/v1/meta/me", { token: jwt });
  assertEquals(response.status, 200);
  assertEquals((await response.json()).assignments, []);
});

// ── Сеанс AUTH-06 ──────────────────────────────────────────────────────────

Deno.test("пределы сеанса: бездействие 30 минут — 401 SESSION_EXPIRED", async () => {
  const { deps, admin } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-old", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  // Сеанс существует и бездействует дольше 30 минут (AUTH-06).
  const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  admin.sessions.set("s-old", {
    id: "s-old",
    profileId: "prof-chair",
    startedAt: stale,
    lastActivityAt: stale,
    lastActivityKind: "start",
    revokedAt: null,
  });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-old" });

  const response = await call(deps, "/v1/meta/me", { token: jwt });
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "SESSION_EXPIRED");
});

Deno.test("пределы сеанса: 12 часов от старта — 401 SESSION_EXPIRED даже при активности", async () => {
  const { deps, admin } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-long", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  admin.sessions.set("s-long", {
    id: "s-long",
    profileId: "prof-chair",
    startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
    lastActivityAt: NOW_ISO(),
    lastActivityKind: "start",
    revokedAt: null,
  });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-long" });

  const response = await call(deps, "/v1/meta/me", { token: jwt });
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "SESSION_EXPIRED");
});

Deno.test("GET /v1/meta/* не продлевает активность, деловой вызов продлевает (М-2)", async () => {
  const { deps, admin } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-chair", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-chair" });

  await call(deps, "/v1/meta/me", { token: jwt });
  assertEquals(admin.sessions.get("s-chair")?.lastActivityKind, "start");

  const auditResponse = await call(deps, "/v1/audit", { token: jwt });
  assertEquals(auditResponse.status, 200);
  assertEquals(admin.sessions.get("s-chair")?.lastActivityKind, "GET /v1/audit");
});

// ── Отзыв полномочий (ROL-04) ──────────────────────────────────────────────

Deno.test("ROL-04: отзыв роли отзывает сеанс — следующий запрос из открытого сеанса не проходит", async () => {
  const { deps, admin, audit } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  const executor = makeTestActor("executor", [B1], { personId: "p-exec" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-chair", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  seedIdentity(admin, { sub: "sub-exec", sessionId: "s-exec", personId: "p-exec", profileId: "prof-exec", actor: executor });
  const execJwt = await token({ sub: "sub-exec", sessionId: "s-exec" });

  // До отзыва деловой запрос проходит.
  const before = await call(deps, "/v1/audit", { token: execJwt });
  assertEquals(before.status, 403); // роли нет — отказ PDP, но сеанс жив

  const assignmentId = executor.assignments[0]!.id;
  await revokeAssignment(
    { admin: admin, audit: audit, tx: deps.db },
    chairman,
    assignmentId,
    "Отзыв в тесте",
    new Date(),
  );

  const after = await call(deps, "/v1/meta/me", { token: execJwt });
  assertEquals(after.status, 401);
  assertEquals((await after.json()).error.code, "SESSION_EXPIRED");
  assertExists(admin.sessions.get("s-exec")?.revokedAt);
});

// ── PDP-отказы в журнал (AUD-01) ───────────────────────────────────────────

Deno.test("отказ PDP — 403 и запись в журнале с причиной", async () => {
  const { deps, admin, audit } = makeDeps();
  const executor = makeTestActor("executor", [B1], { personId: "p-exec" });
  seedIdentity(admin, { sub: "sub-exec", sessionId: "s-exec", personId: "p-exec", profileId: "prof-exec", actor: executor });
  const jwt = await token({ sub: "sub-exec", sessionId: "s-exec" });

  const response = await call(deps, "/v1/admin/assignments", { token: jwt });
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "FORBIDDEN");

  const entry = audit.entries[0]!;
  assertEquals(entry.action, "admin.assignment.list");
  assertEquals(entry.entityType, "access");
  assertEquals(entry.reason, "Требуется роль: chairman, administrator");
  assertEquals(entry.actorPersonId, "p-exec");
});

Deno.test("неизвестный маршрут с валидным токеном — 404 NOT_FOUND", async () => {
  const { deps, admin } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-chair", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-chair" });

  const response = await call(deps, "/v1/unknown-resource", { token: jwt });
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error.code, "NOT_FOUND");
});

Deno.test("маршруты удаления реестра и снятия роли зарегистрированы (PDP-акции верны)", () => {
  const building = matchRoute("DELETE", "/v1/registry/buildings/11111111-1111-1111-1111-111111111111");
  assertEquals(building?.route.action, "registry.write");
  assertEquals(building?.route.evaluateAs, "effective");
  const premises = matchRoute("DELETE", "/v1/registry/premises/11111111-1111-1111-1111-111111111111");
  assertEquals(premises?.route.action, "registry.write");
  const revoke = matchRoute("POST", "/v1/emulation/assignments/a-1/revoke");
  assertEquals(revoke?.route.action, "emulation.person.role.revoke");
  assertEquals(revoke?.route.evaluateAs, "real");
  assertEquals(revoke?.params.id, "a-1");
  // Лица и связи удалению не подлежат — маршрута нет.
  assertEquals(matchRoute("DELETE", "/v1/registry/persons/x"), null);
  assertEquals(matchRoute("DELETE", "/v1/registry/connections/x"), null);
});

// ── Назначения (ROL-02) ────────────────────────────────────────────────────

Deno.test("председатель создаёт назначение — 201, запись в журнале", async () => {
  const { deps, admin, audit } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-chair", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  admin.persons.set("p-new", {
    id: "p-new",
    fullName: "Новый Исполнитель",
    phoneE164: "+79990000001",
    status: "active",
    isTest: false,
    comment: null,
  });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-chair" });

  const response = await call(deps, "/v1/admin/assignments", {
    token: jwt,
    method: "POST",
    body: { person_id: "p-new", role: "executor", scope_building_ids: [B1] },
  });
  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.assignment.role, "executor");
  assertEquals(body.assignment.scope_building_ids, [B1]);
  assertEquals(audit.entries[0]?.action, "admin.assignment.create");
});

Deno.test("администратор выдаёт спецправа — 403 (ROL-02b: только председатель)", async () => {
  const { deps, admin } = makeDeps();
  const administrator = makeTestActor("administrator", [B1, B2], { personId: "p-admin" });
  seedIdentity(admin, { sub: "sub-admin", sessionId: "s-admin", personId: "p-admin", profileId: "prof-admin", actor: administrator });
  admin.persons.set("p-new", {
    id: "p-new",
    fullName: "Кому Права",
    phoneE164: "+79990000002",
    status: "active",
    isTest: false,
    comment: null,
  });
  const jwt = await token({ sub: "sub-admin", sessionId: "s-admin" });

  const response = await call(deps, "/v1/admin/assignments", {
    token: jwt,
    method: "POST",
    body: { person_id: "p-new", role: "executor", financial_rights: true, scope_building_ids: [B1] },
  });
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "FORBIDDEN");
});

// ── Эмуляция (HLD 10.8) — критерий среза ───────────────────────────────────

function seedTestPersona(
  fakes: { admin: MemoryAdminRepo; emulation: MemoryEmulationRepo },
  input: { sub?: string; sessionId?: string } = {},
): TestPersonRecord {
  const { admin, emulation } = fakes;
  const record: TestPersonRecord = {
    person: {
      id: "p-persona",
      fullName: "Тестовая Персона",
      phoneE164: "+700000000001",
      status: "active",
      isTest: true,
      comment: null,
    },
    profile: {
      id: "prof-persona",
      personId: "p-persona",
      telegramUserId: "-1",
      supabaseUserId: input.sub ?? null,
      language: "ru",
      isTest: true,
      archivedAt: null,
    },
  };
  admin.persons.set(record.person.id, record.person);
  admin.profiles.set(record.profile.id, record.profile);
  // Персона — администратор дома B1: увидит записи своей области (AUD-02).
  admin.assignments.set("a-persona", {
    ...assignmentRow({ id: "a-persona", role: "administrator", scopeBuildingIds: [B1] }),
    personId: record.person.id,
    personFullName: record.person.fullName,
    assignedBy: null,
    revokedBy: null,
    createdAt: T0,
  });
  admin.scopes.set("a-persona", [B1]);
  emulation.testPersons.push(record);
  return record;
}

function seedTechAdmin(
  admin: MemoryAdminRepo,
): { actor: Actor; sub: string; sessionId: string } {
  const tech = makeTestActor("tech_admin", [], { personId: "p-tech" });
  const sub = "sub-tech";
  const sessionId = "s-tech";
  seedIdentity(admin, { sub, sessionId, personId: "p-tech", profileId: "prof-tech", actor: tech });
  return { actor: tech, sub, sessionId };
}

Deno.test("эмуляция: старт техадмином, meta/me с пометкой, чтение журнала под персоной — по области, запись с реальным актором и персоной", async () => {
  const { deps, admin, audit, emulation } = makeDeps();
  const tech = seedTechAdmin(admin);
  const persona = seedTestPersona({ admin, emulation }, {});
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });

  // Технические записи журнала: своя область и чужая.
  audit.entries.push(
    {
      id: 1,
      at: T0,
      actorPersonId: "p-someone",
      actorProfileId: null,
      emulationSessionId: null,
      emulatedPersonId: null,
      action: "admin.assignment.create",
      entityType: "staff_assignment",
      entityId: "a-1",
      before: null,
      after: {},
      reason: null,
      scopeBuildings: [B1],
      meta: {},
    },
    {
      id: 2,
      at: T0,
      actorPersonId: "p-someone",
      actorProfileId: null,
      emulationSessionId: null,
      emulatedPersonId: null,
      action: "admin.assignment.create",
      entityType: "staff_assignment",
      entityId: "a-2",
      before: null,
      after: {},
      reason: null,
      scopeBuildings: [B2],
      meta: {},
    },
  );

  // Старт эмуляции (PDP по реальному актору — техадмину).
  const start = await call(deps, "/v1/emulation/sessions", {
    token: techJwt,
    method: "POST",
    body: { emulated_profile_id: persona.profile.id },
  });
  assertEquals(start.status, 201);
  const startBody = await start.json();
  assertEquals(startBody.session.state, "active");

  // meta/me под эмуляцией: персона с пометкой эмуляции.
  const me = await call(deps, "/v1/meta/me", { token: techJwt });
  assertEquals(me.status, 200);
  const meBody = await me.json();
  assertEquals(meBody.person.id, "p-persona");
  assertEquals(meBody.emulation.session_id, startBody.session.id);
  assertEquals(meBody.emulation.real_person_id, "p-tech");
  assertEquals(meBody.emulation.real_person_full_name, "Персона tech_admin");

  // Чтение журнала под персоной-администратором: только своя область (AUD-02).
  const auditRead = await call(deps, "/v1/audit", { token: techJwt });
  assertEquals(auditRead.status, 200);
  const auditBody = await auditRead.json();
  assertEquals(auditBody.entries.length, 1);
  assertEquals(auditBody.entries[0].scope_buildings, [B1]);

  // Запись о чтении: реальный актор + эмулируемая персона (критерий среза).
  const readEntry = audit.entries[audit.entries.length - 1]!;
  assertEquals(readEntry.action, "audit.read");
  assertEquals(readEntry.actorPersonId, "p-tech");
  assertEquals(readEntry.emulatedPersonId, "p-persona");
  assertEquals(readEntry.emulationSessionId, startBody.session.id);
});

Deno.test("эмуляция: privileged-действие под персоной — 403 (HLD 10.8)", async () => {
  const { deps, admin, emulation } = makeDeps();
  const tech = seedTechAdmin(admin);
  const persona = seedTestPersona({ admin, emulation }, {});
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });

  const start = await call(deps, "/v1/emulation/sessions", {
    token: techJwt,
    method: "POST",
    body: { emulated_profile_id: persona.profile.id },
  });
  assertEquals(start.status, 201);

  const response = await call(deps, "/v1/admin/assignments", {
    token: techJwt,
    method: "POST",
    body: { person_id: "p-tech", role: "executor" },
  });
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "FORBIDDEN");
});

Deno.test("эмуляция не-тестового профиля — 403 FORBIDDEN", async () => {
  const { deps, admin } = makeDeps();
  const tech = seedTechAdmin(admin);
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });
  admin.profiles.set("prof-real", {
    id: "prof-real",
    personId: "p-tech",
    telegramUserId: "200",
    supabaseUserId: null,
    language: "ru",
    isTest: false,
    archivedAt: null,
  });

  const response = await call(deps, "/v1/emulation/sessions", {
    token: techJwt,
    method: "POST",
    body: { emulated_profile_id: "prof-real" },
  });
  assertEquals(response.status, 403);
});

Deno.test("симулятор: без эмуляции — 400, неизвестный сценарий — 404", async () => {
  const { deps, admin, emulation } = makeDeps();
  const tech = seedTechAdmin(admin);
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });

  const withoutEmulation = await call(deps, "/v1/emulation/simulate", {
    token: techJwt,
    method: "POST",
    body: { scenario: "menu" },
  });
  assertEquals(withoutEmulation.status, 400);
  assertEquals((await withoutEmulation.json()).error.code, "VALIDATION_FAILED");

  const persona = seedTestPersona({ admin, emulation }, {});
  await call(deps, "/v1/emulation/sessions", {
    token: techJwt,
    method: "POST",
    body: { emulated_profile_id: persona.profile.id },
  });
  const unknown = await call(deps, "/v1/emulation/simulate", {
    token: techJwt,
    method: "POST",
    body: { scenario: "нет-такого" },
  });
  assertEquals(unknown.status, 404);
  assertEquals((await unknown.json()).error.code, "NOT_FOUND");
});

Deno.test("симулятор жителя возвращает текст и inline-кнопки", async () => {
  const { deps, admin, emulation } = makeDeps();
  const tech = seedTechAdmin(admin);
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });
  const persona = seedTestPersona({ admin, emulation }, {});
  await call(deps, "/v1/emulation/sessions", {
    token: techJwt, method: "POST", body: { emulated_profile_id: persona.profile.id },
  });
  const buttons = [[{ text: "Русский", data: "ru" }]];
  deps.scenarios.register({ id: "registration", description: "REG", run: () => Promise.resolve({ text: "Язык", buttons }) });
  const response = await call(deps, "/v1/emulation/simulate", {
    token: techJwt, method: "POST", body: { scenario: "registration", input: "/register" },
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { scenario_id: "registration", reply: "Язык", buttons });
});

Deno.test("эмуляция: техадмин снимает роль тестовой персоны — назначение отозвано, аудит и уведомление", async () => {
  const { deps, admin, audit, emulation } = makeDeps();
  const tech = seedTechAdmin(admin);
  seedTestPersona({ admin, emulation }, {});
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });

  const response = await call(deps, "/v1/emulation/assignments/a-persona/revoke", {
    token: techJwt,
    method: "POST",
    body: { reason: "Роль больше не нужна" },
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.assignment.status, "revoked");
  assertEquals(admin.assignments.get("a-persona")?.status, "revoked");

  const entry = audit.entries.find((e) => e.action === "emulation.person.role.revoke");
  assertExists(entry);
  assertEquals(entry.entityId, "a-persona");
  assertEquals(entry.actorPersonId, "p-tech");
  assertEquals(entry.after, { roles: [] });

  // Уведомление о смене полномочий поставлено в outbox той же транзакцией.
  assertExists((deps.db as MemoryDb).outbox.find((params) =>
    JSON.stringify(params).includes("emulation:a-persona:revoke"),
  ));
});

Deno.test("эмуляция: снятие роли без техадмина — 403, без причины — 400", async () => {
  const { deps, admin, emulation } = makeDeps();
  const tech = seedTechAdmin(admin);
  seedTestPersona({ admin, emulation }, {});
  const techJwt = await token({ sub: tech.sub, sessionId: tech.sessionId });

  const noReason = await call(deps, "/v1/emulation/assignments/a-persona/revoke", {
    token: techJwt,
    method: "POST",
    body: { reason: "   " },
  });
  assertEquals(noReason.status, 400);
  assertEquals((await noReason.json()).error.code, "VALIDATION_FAILED");
  assertEquals(admin.assignments.get("a-persona")?.status, "active");

  // Не техадмин: PDP-отказ по реальному актору.
  const executor = makeTestActor("executor", [B1], { personId: "p-exec" });
  seedIdentity(admin, { sub: "sub-exec", sessionId: "s-exec", personId: executor.person.id, profileId: executor.profile.id, actor: executor });
  const execJwt = await token({ sub: "sub-exec", sessionId: "s-exec" });
  const forbidden = await call(deps, "/v1/emulation/assignments/a-persona/revoke", {
    token: execJwt,
    method: "POST",
    body: { reason: "Причина" },
  });
  assertEquals(forbidden.status, 403);
  assertEquals(admin.assignments.get("a-persona")?.status, "active");
});

// ── CORS и заголовки приватности ───────────────────────────────────────────

Deno.test("preflight OPTIONS — 204 с CORS-заголовками для localhost (без CABINET_ORIGIN)", async () => {
  const { deps } = makeDeps();
  const response = await handleWithDeps(
    new Request("https://example.functions/v1/meta/me", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    }),
    deps,
  );
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
});

Deno.test("чужой origin — без CORS-заголовков; не-браузерный запрос работает", async () => {
  const { deps, admin } = makeDeps();
  const chairman = makeTestActor("chairman", [], { personId: "p-chair" });
  seedIdentity(admin, { sub: "sub-chair", sessionId: "s-chair", personId: "p-chair", profileId: "prof-chair", actor: chairman });
  const jwt = await token({ sub: "sub-chair", sessionId: "s-chair" });

  const foreign = await call(deps, "/v1/meta/me", { token: jwt, origin: "https://evil.example" });
  assertEquals(foreign.headers.get("access-control-allow-origin"), null);
  assertEquals(foreign.status, 200);

  const noOrigin = await call(deps, "/v1/meta/me", { token: jwt });
  assertEquals(noOrigin.headers.get("access-control-allow-origin"), null);
  assertEquals(noOrigin.status, 200);
});

Deno.test("VS-0: запрос без токена и без env — 401 (env читается после проверки заголовка)", async () => {
  const response = await handle(
    new Request("https://example.functions/v1/requests"),
    () => undefined,
  );
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHENTICATED");
});

Deno.test("VS-2: заместитель без права экспорта блокируется PDP и журналируется", async () => {
  const {deps,admin,audit}=makeDeps();
  const actor=makeTestActor("deputy",[B1],{personId:"p-registry"});
  seedIdentity(admin,{sub:"sub-registry",sessionId:"s-registry",personId:actor.person.id,profileId:actor.profile.id,actor});
  const jwt=await token({sub:"sub-registry",sessionId:"s-registry"});
  const response=await call(deps,"/v1/registry/export",{token:jwt,method:"POST",body:{}});
  assertEquals(response.status,403);
  assertEquals((await response.json()).error.code,"FORBIDDEN");
  assertEquals(audit.entries.some(e=>e.action==="registry.export"),true);
});
Deno.test("VS-2: роли жителя недостаточно для чтения персонального реестра",async()=>{
  const {deps,admin}=makeDeps();
  const actor=buildActor({id:"resident",fullName:"Житель",status:"active",isTest:false},{id:"resident-profile",personId:"resident",language:"ru",isTest:false},[],new Date());
  seedIdentity(admin,{sub:"sub-resident",sessionId:"s-resident",personId:actor.person.id,profileId:actor.profile.id,actor});
  const response=await call(deps,"/v1/registry/persons",{token:await token({sub:"sub-resident",sessionId:"s-resident"})});
  assertEquals(response.status,403);
});

Deno.test("VS-3: общий rate limit возвращает 429 до выполнения обработчика",async()=>{
 const {deps,admin}=makeDeps();
 const actor=makeTestActor("chairman",[],{personId:"p-chair"});
 seedIdentity(admin,{sub:"sub-chair",sessionId:"s-chair",personId:"p-chair",profileId:"prof-chair",actor});
 const {ApiError}=await import("../../core/src/errors/api.ts");
 deps.rateLimit=profileId=>{assertEquals(profileId,"prof-chair");return Promise.reject(new ApiError("RATE_LIMITED"));};
 const jwt=await token({sub:"sub-chair",sessionId:"s-chair"});
 const response=await call(deps,"/v1/requests",{token:jwt});
 assertEquals(response.status,429);assertEquals((await response.json()).error.code,"RATE_LIMITED");
});

Deno.test("VS-5: расписание требует полномочий, даты с часовым поясом и существующей области",async()=>{
 const {deps,admin}=makeDeps();
 const actor=makeTestActor("administrator",[B1],{personId:"p-schedule"});
 seedIdentity(admin,{sub:"sub-schedule",sessionId:"s-schedule",personId:actor.person.id,profileId:actor.profile.id,actor});
 const jwt=await token({sub:"sub-schedule",sessionId:"s-schedule"});
 const path="/v1/job-templates/11111111-1111-1111-1111-111111111111/schedule";
 const unauthenticated=await call(deps,path,{});
 assertEquals(unauthenticated.status,401);
 const invalid=await call(deps,path,{token:jwt,method:"POST",body:{enabled:true,next_run_at:"2026-10-18T08:00:00",interval_hours:24,due_hours:8}});
 assertEquals(invalid.status,400);
 assertEquals((await invalid.json()).error.code,"VALIDATION_FAILED");
 const originalQuery=deps.db.query.bind(deps.db);
 deps.db.query=(sql,params)=>sql.includes("from job_template") ? Promise.resolve([]) : originalQuery(sql,params);
 const missing=await call(deps,path,{token:jwt});
 assertEquals(missing.status,403);
});

Deno.test("VS-5 TIM-02: API раскрывает исходные условия и запрещает подмену действия",async()=>{
 const {deps,admin}=makeDeps();
 const actor=makeTestActor("chairman",[],{personId:"p-rules"});
 seedIdentity(admin,{sub:"sub-rules",sessionId:"s-rules",personId:actor.person.id,profileId:actor.profile.id,actor});
 const jwt=await token({sub:"sub-rules",sessionId:"s-rules"});
 const originalQuery=deps.db.query.bind(deps.db);
 deps.db.query=<T>(sql:string,params?:readonly unknown[])=>sql.includes("from time_rule r left join time_rule_version") ? Promise.resolve([{key:"author_reminder",params:{hours:48,clock:"calendar"}}] as T[]) : originalQuery<T>(sql,params);
 const view=await call(deps,"/v1/registry/time-rules",{token:jwt});
 assertEquals(view.status,200);
 const row=(await view.json()).items[0];
 assertEquals(row.contract.action,"request.remind_author");
 assertEquals(row.contract_legacy,true);
 const invalid=await call(deps,"/v1/registry/time-rules/author_reminder",{token:jwt,method:"POST",body:{params:{hours:48,clock:"calendar",action:"request.close"},reason:"Подмена"}});
 assertEquals(invalid.status,400);
 assertEquals((await invalid.json()).error.code,"VALIDATION_FAILED");
});

Deno.test("ROL-02f: профиль разделяет назначенную роль и унаследованные возможности", async()=>{
  const {deps,admin}=makeDeps();
  const actor=makeTestActor("administrator",[B1],{personId:"p-hierarchy"});
  seedIdentity(admin,{sub:"sub-hierarchy",sessionId:"s-hierarchy",personId:actor.person.id,profileId:actor.profile.id,actor});
  const response=await call(deps,"/v1/meta/me",{token:await token({sub:"sub-hierarchy",sessionId:"s-hierarchy"})});
  assertEquals(response.status,200);
  const body=await response.json();
  assertEquals(body.assigned_roles,["administrator"]);
  assertEquals(body.effective_roles.includes("finance"),true);
  assertEquals(body.effective_roles.includes("tech_admin"),false);
  assertEquals(body.assignments.map((a:{role:string})=>a.role),["administrator"]);
});

Deno.test("управление анкетой использует отдельный privileged PDP-маршрут", () => {
  const route = matchRoute("POST", "/v1/registrations/11111111-1111-1111-1111-111111111111/manage");
  assertEquals(route?.route.action, "registration.manage");
  assertEquals(route?.route.evaluateAs, "effective");
  assertEquals(route?.params.id, "11111111-1111-1111-1111-111111111111");
});

Deno.test("журнал регистраций — отдельный GET-маршрут с правом списка анкет", () => {
  const route = matchRoute("GET", "/v1/registrations/journal");
  assertEquals(route?.route.action, "registration.review");
  assertEquals(route?.route.evaluateAs, "effective");
  assertEquals(route?.params, {});
});

Deno.test("исполнитель не управляет чужой анкетой через прямой API", async () => {
  const { deps, admin } = makeDeps();
  const executor = makeTestActor("executor", [], { personId: "p-executor" });
  seedIdentity(admin, { sub: "sub-executor", sessionId: "s-executor", personId: "p-executor", profileId: "prof-executor", actor: executor });
  const jwt = await token({ sub: "sub-executor", sessionId: "s-executor" });
  const response = await call(deps, "/v1/registrations/11111111-1111-1111-1111-111111111111/manage", {
    token: jwt, method: "POST", body: { operation: "delete", expected_version: 1, reason: "Проверка отказа" },
  });
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "FORBIDDEN");
});
