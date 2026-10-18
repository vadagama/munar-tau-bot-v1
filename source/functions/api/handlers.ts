import { canManageStaff, canManageRole } from "../../core/src/pdp/roles.ts";
import { STAFF_ROUTES } from "./staff-handlers.ts";
import { TEMPLATE_ROUTES } from "./template-handlers.ts";
import { PUBLICATION_ROUTES } from "./publication-handlers.ts";
import { INCIDENT_ROUTES } from "./incident-handlers.ts";
import { NOTIFICATION_ROUTES } from "./notification-handlers.ts";
import { REQUEST_ROUTES } from "./request-handlers.ts";
import { TASK_ROUTES } from "./task-handlers.ts";
import { REGISTRY_ROUTES } from "./registry-handlers.ts";
// Маршруты VS-1 (LLD-03 §3.1, §3.13–3.14, §3.16). Каждому маршруту — действие
// PDP и актор оценки: effective — бизнес-действия (под эмуляцией — персона),
// real — управление эмуляцией (всегда техадминистратор). Привилегированные
// действия пишут журнал в сервисах; отказы PDP и чтение журнала — в конвейере.

import {
  type ActionKey,
  type ResourceRef,
  STAFF_ROLES,
  SESSION_IDLE_LIMIT_MS,
  SESSION_TOTAL_LIMIT_MS,
  type StaffRole,
  type Actor,
  type AssignmentRow,
  type AuditListFilter,
  type AuditEntry,
  auditVisibilityForActor,
  buildAuditInput,
  type AccessSessionRecord,
} from "../../core/src/index.ts";
import { ApiError } from "../../core/src/errors/api.ts";
import {
  createAssignment,
  revokeAccessSessionById,
  revokeAssignment,
  updateAssignment,
} from "../../core/src/domains/admin/service.ts";
import {
  createTestPerson,
  endEmulation,
  simulate,
  startEmulation,
} from "../../core/src/domains/emulation/service.ts";
import type { AssignmentListRecord } from "../../core/src/domains/admin/port.ts";
import type { EmulationSessionRecord } from "../../core/src/domains/emulation/port.ts";
import type { ApiDeps } from "./deps.ts";
import {
  limitParam,
  optionalBoolean,
  optionalNullableString,
  optionalString,
  optionalStringArray,
  requireString,
} from "./http.ts";

export interface RouteContext {
  request: Request;
  url: URL;
  deps: ApiDeps;
  /** Эффективный актор (эмулированная персона, если эмуляция активна). */
  actor: Actor;
  /** Реальный актор (владелец JWT). */
  realActor: Actor;
  /** Сеанс JWT (access_session) — пределы AUTH-06 считаются по нему. */
  session: AccessSessionRecord;
  params: Record<string, string>;
  body: Record<string, unknown>;
}

export interface Route {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Шаблон пути с параметрами :name (после нормализации к /v1/...). */
  path: string;
  action: ActionKey;
  /** Чей Actor оценивает PDP: effective (бизнес) или real (управление эмуляцией). */
  evaluateAs: "effective" | "real";
  /** Ресурс для PDP; по умолчанию — без свойств. */
  resource?: (ctx: RouteContext) => Promise<ResourceRef> | ResourceRef;
  handler: (ctx: RouteContext) => Promise<RouteResult>;
}

export interface RouteResult {
  status?: number;
  body: unknown;
}

// ── Сериализация: core camelCase → JSON API snake_case (LLD-03 §4.1) ────────

function serializeAssignmentRow(row: AssignmentRow): Record<string, unknown> {
  return {
    id: row.id,
    role: row.role,
    financial_rights: row.financialRights,
    registry_export_rights: row.registryExportRights,
    regulations_rights: row.regulationsRights,
    status: row.status,
    valid_from: row.validFrom,
    valid_until: row.validUntil,
    scope_building_ids: row.scopeBuildingIds,
  };
}

function serializeAssignment(record: AssignmentListRecord): Record<string, unknown> {
  return {
    ...serializeAssignmentRow(record),
    person_id: record.personId,
    person_full_name: record.personFullName,
    assigned_by: record.assignedBy,
    revoked_by: record.revokedBy,
    created_at: record.createdAt,
  };
}

function serializeSession(record: AccessSessionRecord): Record<string, unknown> {
  return {
    id: record.id,
    profile_id: record.profileId,
    started_at: record.startedAt,
    last_activity_at: record.lastActivityAt,
    last_activity_kind: record.lastActivityKind,
    revoked_at: record.revokedAt,
    revoked_reason: record.revokedReason ?? null,
  };
}

function serializeEmulationSession(record: EmulationSessionRecord): Record<string, unknown> {
  return {
    id: record.id,
    tech_admin_profile_id: record.techAdminProfileId,
    emulated_profile_id: record.emulatedProfileId,
    started_at: record.startedAt,
    ended_at: record.endedAt,
    state: record.state,
  };
}

function serializeAuditEntry(entry: AuditEntry): Record<string, unknown> {
  return {
    id: entry.id,
    at: entry.at,
    actor_person_id: entry.actorPersonId,
    actor_profile_id: entry.actorProfileId,
    emulation_session_id: entry.emulationSessionId,
    emulated_person_id: entry.emulatedPersonId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    scope_buildings: entry.scopeBuildings,
    meta: entry.meta,
  };
}

// ── Валидация входа ────────────────────────────────────────────────────────

function requireStaffRole(body: Record<string, unknown>): StaffRole {
  const value = requireString(body, "role");
  if (!STAFF_ROLES.includes(value as StaffRole)) {
    throw new ApiError("VALIDATION_FAILED", `Неизвестная роль: ${value}`);
  }
  return value as StaffRole;
}

// ── meta ───────────────────────────────────────────────────────────────────

function handleMetaMe(ctx: RouteContext): RouteResult {
  const { actor, session } = ctx;
  return {
    body: {
      profile: {
        id: actor.profile.id,
        person_id: actor.profile.personId,
        language: actor.profile.language,
        is_test: actor.profile.isTest,
      },
      person: {
        id: actor.person.id,
        full_name: actor.person.fullName,
        status: actor.person.status,
        is_test: actor.person.isTest,
      },
      // scope_building_ids: null — весь ОСИ (ROL-02a).
      effective_roles: [...new Set(actor.assignments.map(a=>a.role))],
      assigned_roles: actor.assignedRoles ?? [...new Set(actor.assignments.map(a=>a.role))],
      assignments: actor.assignments.filter(a=>!a.inherited).map((assignment) => ({
        id: assignment.id,
        role: assignment.role,
        financial_rights: assignment.financialRights,
        registry_export_rights: assignment.registryExportRights,
        regulations_rights: assignment.regulationsRights,
        scope_building_ids: assignment.scopeBuildingIds ?? null,
      })),
      session: {
        id: session.id,
        started_at: session.startedAt,
        last_activity_at: session.lastActivityAt,
        total_limit_seconds: SESSION_TOTAL_LIMIT_MS / 1000,
        idle_limit_seconds: SESSION_IDLE_LIMIT_MS / 1000,
      },
      emulation: actor.emulation
        ? {
            session_id: actor.emulation.sessionId,
            real_person_id: actor.emulation.realPersonId,
            real_profile_id: actor.emulation.realProfileId,
            // Имя реального актора — для баннера режима эмуляции (HLD 10.8).
            real_person_full_name: ctx.realActor.person.fullName,
          }
        : null,
    },
  };
}

function handleDictionary(): RouteResult {
  return {
    body: {
      roles: STAFF_ROLES,
      languages: ["ru", "kk"],
    },
  };
}

// ── audit (AUD-01/02) ──────────────────────────────────────────────────────

async function handleAuditList(ctx: RouteContext): Promise<RouteResult> {
  const { deps, actor, url } = ctx;
  // Защита в глубину: PDP уже пустил только три роли.
  const visibility = auditVisibilityForActor(actor);
  const filter: AuditListFilter = {
    entityType: url.searchParams.get("entity_type") ?? undefined,
    entityId: url.searchParams.get("entity_id") ?? undefined,
    actorPersonId: url.searchParams.get("actor_person_id") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    limit: limitParam(url),
    cursor: url.searchParams.get("cursor") ?? undefined,
  };
  const page = await deps.audit.list(deps.db, filter, visibility);
  // Чтение журнала — само событие журнала (план VS-1); под эмуляцией запись
  // получит реального актора и эмулируемую персону (критерий среза).
  await deps.audit.append(deps.db, buildAuditInput(actor, {
    action: "audit.read",
    entityType: "audit",
    meta: {
      entity_type: filter.entityType ?? null,
      entity_id: filter.entityId ?? null,
      actor_person_id: filter.actorPersonId ?? null,
    },
  }));
  return {
    body: {
      entries: page.entries.map(serializeAuditEntry),
      next_cursor: page.nextCursor,
    },
  };
}

// ── admin (ROL-02–04, AUTH-06) ─────────────────────────────────────────────

async function handlePersonsLookup(ctx: RouteContext): Promise<RouteResult> {
  const { deps, url } = ctx;
  const query = url.searchParams.get("q") ?? "";
  const persons = await deps.admin.listPersonsLookup(deps.db, query, limitParam(url, 20));
  return {
    body: {
      persons: persons.map((person) => ({
        id: person.id,
        full_name: person.fullName,
        phone_e164: person.phoneE164,
        is_test: person.isTest,
      })),
    },
  };
}

async function handleAssignmentsList(ctx: RouteContext): Promise<RouteResult> {
  const { deps, url } = ctx;
  const activeOnly = url.searchParams.get("active_only") !== "false";
  const list = await deps.admin.listAssignments(deps.db, {
    activeOnly,
    limit: limitParam(url),
  });
  return { body: { assignments: list.map(serializeAssignment) } };
}

function specialRightsIn(body: Record<string, unknown>): boolean {
  return (
    body.financial_rights === true ||
    body.registry_export_rights === true ||
    body.regulations_rights === true
  );
}

async function requireLegacyStaffTarget(ctx: RouteContext, personId: string, role?: StaffRole) {
  const rows=await ctx.deps.admin.listAssignments(ctx.deps.db,{personId,activeOnly:true,limit:5000});
  const person=await ctx.deps.admin.getPerson(ctx.deps.db,personId);
  if (!person || person.isTest!==ctx.actor.person.isTest || !canManageStaff(ctx.actor,personId,rows.map(r=>r.role)) ||
    (role && !canManageRole(ctx.actor.assignedRoles ?? ctx.actor.assignments.map(a=>a.role),role))) throw new ApiError("FORBIDDEN");
}
async function handleAssignmentCreate(ctx: RouteContext): Promise<RouteResult> {
  const { deps, actor, body } = ctx;
  await requireLegacyStaffTarget(ctx, requireString(body,"person_id"), requireStaffRole(body));
  const financialRights = optionalBoolean(body, "financial_rights") ?? false;
  const registryExportRights = optionalBoolean(body, "registry_export_rights") ?? false;
  const regulationsRights = optionalBoolean(body, "regulations_rights") ?? false;
  const created = await createAssignment(
    { admin: deps.admin, audit: deps.audit, tx: deps.db },
    actor,
    {
      personId: requireString(body, "person_id"),
      role: requireStaffRole(body),
      financialRights,
      registryExportRights,
      regulationsRights,
      validFrom: optionalNullableString(body, "valid_from") ?? null,
      validUntil: optionalNullableString(body, "valid_until") ?? null,
      scopeBuildingIds: optionalStringArray(body, "scope_building_ids") ?? [],
      assignedByPersonId: actor.person.id,
    },
  );
  return { status: 201, body: { assignment: serializeAssignment(created) } };
}

async function handleAssignmentUpdate(ctx: RouteContext): Promise<RouteResult> {
  const existing=await ctx.deps.admin.getAssignment(ctx.deps.db,ctx.params.id!);
  if(existing) await requireLegacyStaffTarget(ctx,existing.personId,existing.role);
  const { deps, actor, body, params } = ctx;
  const assignmentId = params.id!;
  const updated = await updateAssignment(
    { admin: deps.admin, audit: deps.audit, tx: deps.db },
    actor,
    assignmentId,
    {
      financialRights: optionalBoolean(body, "financial_rights"),
      registryExportRights: optionalBoolean(body, "registry_export_rights"),
      regulationsRights: optionalBoolean(body, "regulations_rights"),
      validUntil: optionalNullableString(body, "valid_until"),
      scopeBuildingIds: optionalStringArray(body, "scope_building_ids"),
    },
  );
  return { body: { assignment: serializeAssignment(updated) } };
}

/** Ресурс PATCH: текущее состояние назначения — для правил ROL-02a/b/c. */
async function assignmentUpdateResource(ctx: RouteContext): Promise<ResourceRef> {
  const current = await ctx.deps.admin.getAssignment(ctx.deps.db, ctx.params.id!);
  const patchScope = optionalStringArray(ctx.body, "scope_building_ids");
  const patchValidUntil = optionalNullableString(ctx.body, "valid_until");
  return {
    kind: "assignment",
    id: ctx.params.id,
    targetRole: current?.role,
    targetSpecialRights: specialRightsIn(ctx.body),
    targetValidUntil: patchValidUntil !== undefined ? patchValidUntil : current?.validUntil ?? null,
    buildingIds: patchScope ?? current?.scopeBuildingIds ?? [],
  };
}

async function handleSessionsList(ctx: RouteContext): Promise<RouteResult> {
  const { deps, url } = ctx;
  const profileId = url.searchParams.get("profile_id") ?? undefined;
  const activeOnly = url.searchParams.get("active_only") !== "false";
  const sessions = await deps.admin.listAccessSessions(deps.db, {
    activeOnly,
    profileId,
    limit: limitParam(url),
  });
  return {
    body: {
      sessions: sessions.map((item) => ({
        ...serializeSession(item),
        person_full_name: item.personFullName,
        person_is_test: item.personIsTest,
      })),
    },
  };
}

async function handleSessionRevoke(ctx: RouteContext): Promise<RouteResult> {
  const { deps, actor, body, params } = ctx;
  const revoked = await revokeAccessSessionById(
    { admin: deps.admin, audit: deps.audit, tx: deps.db },
    actor,
    params.id!,
    optionalString(body, "reason") ?? "Отозвано через кабинет",
    new Date(),
  );
  return { body: { session: serializeSession(revoked) } };
}

/** Ресурс отзыва сеанса: владелец — для правила «свой сеанс» (AUTH-06). */
async function sessionRevokeResource(ctx: RouteContext): Promise<ResourceRef> {
  const session = await ctx.deps.admin.getAccessSession(ctx.deps.db, ctx.params.id!);
  return { kind: "access_session", id: ctx.params.id, profileId: session?.profileId };
}

async function handleAssignmentRevoke(ctx: RouteContext): Promise<RouteResult> {
  const existing=await ctx.deps.admin.getAssignment(ctx.deps.db,ctx.params.id!);
  if(existing) await requireLegacyStaffTarget(ctx,existing.personId,existing.role);
  const { deps, actor, body, params } = ctx;
  const revoked = await revokeAssignment(
    { admin: deps.admin, audit: deps.audit, tx: deps.db },
    actor,
    params.id!,
    requireString(body, "reason"),
    new Date(),
  );
  return { body: { assignment: serializeAssignment(revoked) } };
}

/** Ресурс отзыва назначения: текущая роль/область — для правил ROL-02a/c. */
async function assignmentRevokeResource(ctx: RouteContext): Promise<ResourceRef> {
  const current = await ctx.deps.admin.getAssignment(ctx.deps.db, ctx.params.id!);
  return {
    kind: "assignment",
    id: ctx.params.id,
    targetRole: current?.role,
    buildingIds: current?.scopeBuildingIds ?? [],
  };
}

// ── emulation (HLD 10.8) — PDP всегда по реальному актору ──────────────────

async function handleEmulationPersonsList(ctx: RouteContext): Promise<RouteResult> {
  const { deps } = ctx;
  const persons = await deps.emulation.listTestPersons(deps.db);
  const enriched = await Promise.all(
    persons.map(async (record) => {
      const assignments = await deps.admin.listActiveAssignments(deps.db, record.person.id);
      return {
        person: {
          id: record.person.id,
          full_name: record.person.fullName,
          phone_e164: record.person.phoneE164,
          status: record.person.status,
        },
        profile: {
          id: record.profile.id,
          telegram_user_id: record.profile.telegramUserId,
          language: record.profile.language,
        },
        assignments: assignments.map(serializeAssignmentRow),
      };
    }),
  );
  return { body: { persons: enriched } };
}

async function handleEmulationPersonCreate(ctx: RouteContext): Promise<RouteResult> {
  const { deps, realActor, body } = ctx;
  const record = await createTestPerson(
    { admin: deps.admin, emulation: deps.emulation, audit: deps.audit, tx: deps.db },
    realActor,
    { fullName: requireString(body, "full_name") },
  );
  return {
    status: 201,
    body: {
      person: {
        id: record.person.id,
        full_name: record.person.fullName,
        phone_e164: record.person.phoneE164,
        is_test: record.person.isTest,
      },
      profile: {
        id: record.profile.id,
        telegram_user_id: record.profile.telegramUserId,
        is_test: record.profile.isTest,
      },
    },
  };
}

async function handleEmulationStart(ctx: RouteContext): Promise<RouteResult> {
  const { deps, realActor, body } = ctx;
  const session = await startEmulation(
    { admin: deps.admin, emulation: deps.emulation, audit: deps.audit, tx: deps.db },
    realActor,
    { emulatedProfileId: requireString(body, "emulated_profile_id") },
    new Date(),
  );
  return { status: 201, body: { session: serializeEmulationSession(session) } };
}

async function handleEmulationEnd(ctx: RouteContext): Promise<RouteResult> {
  const { deps, realActor, params } = ctx;
  const session = await endEmulation(
    { admin: deps.admin, emulation: deps.emulation, audit: deps.audit, tx: deps.db },
    realActor,
    params.id!,
    new Date(),
  );
  return { body: { session: serializeEmulationSession(session) } };
}

async function handleEmulationSimulate(ctx: RouteContext): Promise<RouteResult> {
  const { deps, actor, body } = ctx;
  // Шаг исполняется под эффективным актором (персоной); PDP проверил роль
  // реального актора (техадмин), сервис требует активный сеанс эмуляции.
  const result = await simulate(
    {
      admin: deps.admin,
      emulation: deps.emulation,
      audit: deps.audit,
      tx: deps.db,
      scenarios: deps.scenarios,
    },
    actor,
    {
      scenarioId: requireString(body, "scenario"),
      text: optionalString(body, "input"),
    },
  );
  return { body: { scenario_id: result.scenarioId, reply: result.reply } };
}

// ── Таблица маршрутов VS-1 ─────────────────────────────────────────────────

export const ROUTES: readonly Route[] = [
  ...STAFF_ROUTES,
  ...NOTIFICATION_ROUTES,
  ...TEMPLATE_ROUTES,
  ...REGISTRY_ROUTES,
  ...REQUEST_ROUTES,
  ...TASK_ROUTES,
  ...INCIDENT_ROUTES,
  ...PUBLICATION_ROUTES,
  {
    method: "GET",
    path: "/v1/meta/me",
    action: "meta.me",
    evaluateAs: "effective",
    handler: (ctx) => Promise.resolve(handleMetaMe(ctx)),
  },
  {
    method: "GET",
    path: "/v1/meta/dictionary",
    action: "meta.dictionary",
    evaluateAs: "effective",
    handler: () => Promise.resolve(handleDictionary()),
  },
  {
    method: "GET",
    path: "/v1/audit",
    action: "audit.read",
    evaluateAs: "effective",
    handler: handleAuditList,
  },
  {
    method: "GET",
    path: "/v1/admin/persons-lookup",
    action: "admin.persons.lookup",
    evaluateAs: "effective",
    handler: handlePersonsLookup,
  },
  {
    method: "GET",
    path: "/v1/admin/assignments",
    action: "admin.assignment.list",
    evaluateAs: "effective",
    handler: handleAssignmentsList,
  },
  {
    method: "POST",
    path: "/v1/admin/assignments",
    action: "admin.assignment.create",
    evaluateAs: "effective",
    resource: (ctx) => Promise.resolve({
      kind: "assignment",
      targetRole: requireStaffRole(ctx.body),
      targetSpecialRights: specialRightsIn(ctx.body),
      targetValidUntil: optionalNullableString(ctx.body, "valid_until") ?? null,
      buildingIds: optionalStringArray(ctx.body, "scope_building_ids") ?? [],
    }),
    handler: handleAssignmentCreate,
  },
  {
    method: "PATCH",
    path: "/v1/admin/assignments/:id",
    action: "admin.assignment.update",
    evaluateAs: "effective",
    resource: assignmentUpdateResource,
    handler: handleAssignmentUpdate,
  },
  {
    method: "POST",
    path: "/v1/admin/assignments/:id/revoke",
    action: "admin.assignment.update",
    evaluateAs: "effective",
    resource: assignmentRevokeResource,
    handler: handleAssignmentRevoke,
  },
  {
    method: "GET",
    path: "/v1/admin/sessions",
    action: "admin.session.list",
    evaluateAs: "effective",
    handler: handleSessionsList,
  },
  {
    method: "POST",
    path: "/v1/admin/sessions/:id/revoke",
    action: "admin.session.revoke",
    evaluateAs: "effective",
    resource: sessionRevokeResource,
    handler: handleSessionRevoke,
  },
  {
    method: "GET",
    path: "/v1/emulation/persons",
    action: "emulation.person.list",
    evaluateAs: "real",
    handler: handleEmulationPersonsList,
  },
  {
    method: "POST",
    path: "/v1/emulation/persons",
    action: "emulation.person.create",
    evaluateAs: "real",
    handler: handleEmulationPersonCreate,
  },
  {
    method: "POST",
    path: "/v1/emulation/sessions",
    action: "emulation.session.start",
    evaluateAs: "real",
    handler: handleEmulationStart,
  },
  {
    method: "DELETE",
    path: "/v1/emulation/sessions/:id",
    action: "emulation.session.end",
    evaluateAs: "real",
    handler: handleEmulationEnd,
  },
  {
    method: "POST",
    path: "/v1/emulation/simulate",
    action: "emulation.simulate",
    evaluateAs: "real",
    handler: handleEmulationSimulate,
  },
];

/** Сопоставление маршрута: метод + шаблон пути с :param. */
export function matchRoute(
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, path);
    if (params !== null) return { route, params };
  }
  return null;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter((part) => part !== "");
  const pathParts = path.split("/").filter((part) => part !== "");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index++) {
    const patternPart = patternParts[index]!;
    const pathPart = pathParts[index]!;
    if (patternPart.startsWith(":")) {
      try {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } catch {
        return null;
      }
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

/** Сопоставление маршрута: метод + шаблон пути с :param. */
