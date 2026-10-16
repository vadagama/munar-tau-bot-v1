// In-memory фейки репозиториев для тестов ядра и функций (ADR-003: SQL-код
// проверяется при деплое, логика — на фейках). Семантика повторяет
// SQL-реализации: статусы, отзыв, уникальность активного сеанса эмуляции.
// MemoryDb — одновременно DbExecutor (бросает: SQL в фейках недоступен)
// и DbTransactionRunner (пропускает вызов внутрь).

import type { DbClient, DbExecutor } from "../db/client.ts";
import type { AccessSessionRecord } from "../auth/session.ts";
import type { AssignmentRow } from "../pdp/actor.ts";
import {
  type AccessSessionListItem,
  type AccessSessionListFilter,
  type AdminRepo,
  type AssignmentFieldPatch,
  type AssignmentListFilter,
  type AssignmentListRecord,
  type NewAssignmentInput,
  type PersonLookupRecord,
  type PersonRecord,
  type ProfileRecord,
} from "../domains/admin/port.ts";
import {
  type AuditEntry,
  type AuditEntryInput,
  type AuditListFilter,
  type AuditPage,
  type AuditRepo,
  type AuditVisibility,
} from "../domains/audit/port.ts";
import { decodeAuditCursor, encodeAuditCursor, isVisibleEntry } from "../domains/audit/logic.ts";
import {
  type EmulationRepo,
  type EmulationSessionRecord,
  type TestPersonRecord,
} from "../domains/emulation/port.ts";

/** Пустой исполнитель: тесты работают на фейках, SQL-запросы не выполняются. */
export class MemoryDb implements DbClient {
  public async query<T>(): Promise<T[]> {
    throw new Error("MemoryDb не исполняет SQL — используйте фейки репозиториев");
  }

  public async transaction<T>(fn: (exec: DbExecutor) => Promise<T>): Promise<T> {
    return fn(this);
  }

  public async close(): Promise<void> {}
}

function iso(value: Date): string {
  return value.toISOString();
}

/** Фейк домена администрирования. Состояние открыто тестам для подготовки. */
export class MemoryAdminRepo implements AdminRepo {
  public readonly persons = new Map<string, PersonRecord>();
  public readonly profiles = new Map<string, ProfileRecord>();
  public readonly assignments = new Map<string, AssignmentListRecord>();
  /** Область назначения: assignmentId → дома. */
  public readonly scopes = new Map<string, string[]>();
  public readonly sessions = new Map<string, AccessSessionRecord>();

  // ── Профили и персоны ─────────────────────────────────────────────────────

  public async findProfileBySupabaseUserId(
    _exec: DbExecutor,
    supabaseUserId: string,
  ): Promise<ProfileRecord | null> {
    for (const profile of this.profiles.values()) {
      if (profile.supabaseUserId === supabaseUserId && profile.archivedAt === null) {
        return { ...profile };
      }
    }
    return null;
  }

  public async getPerson(_exec: DbExecutor, personId: string): Promise<PersonRecord | null> {
    const person = this.persons.get(personId);
    return person ? { ...person } : null;
  }

  public async getProfile(_exec: DbExecutor, profileId: string): Promise<ProfileRecord | null> {
    const profile = this.profiles.get(profileId);
    return profile ? { ...profile } : null;
  }

  public async listPersonsLookup(
    _exec: DbExecutor,
    query: string,
    limit: number,
  ): Promise<PersonLookupRecord[]> {
    const needle = query.toLowerCase();
    const found: PersonLookupRecord[] = [];
    for (const person of this.persons.values()) {
      if (person.status !== "active") continue;
      const matches =
        person.fullName.toLowerCase().includes(needle) ||
        person.phoneE164.toLowerCase().includes(needle);
      if (!matches) continue;
      found.push({ id: person.id, fullName: person.fullName, phoneE164: person.phoneE164, isTest: person.isTest });
      if (found.length >= limit) break;
    }
    return found;
  }

  // ── Назначения ────────────────────────────────────────────────────────────

  public async listActiveAssignments(_exec: DbExecutor, personId: string): Promise<AssignmentRow[]> {
    const rows: AssignmentRow[] = [];
    for (const assignment of this.assignments.values()) {
      if (assignment.personId !== personId || assignment.status !== "active") continue;
      rows.push({
        id: assignment.id,
        role: assignment.role,
        financialRights: assignment.financialRights,
        registryExportRights: assignment.registryExportRights,
        regulationsRights: assignment.regulationsRights,
        status: assignment.status,
        validFrom: assignment.validFrom,
        validUntil: assignment.validUntil,
        scopeBuildingIds: [...(this.scopes.get(assignment.id) ?? [])],
      });
    }
    return rows;
  }

  public async listAssignments(
    _exec: DbExecutor,
    filter: AssignmentListFilter,
  ): Promise<AssignmentListRecord[]> {
    const rows = [...this.assignments.values()]
      .filter((a) => (filter.activeOnly ? a.status === "active" : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, filter.limit);
    return rows.map((a) => ({ ...a, scopeBuildingIds: [...(this.scopes.get(a.id) ?? [])] }));
  }

  public async getAssignment(
    _exec: DbExecutor,
    assignmentId: string,
  ): Promise<AssignmentListRecord | null> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) return null;
    return { ...assignment, scopeBuildingIds: [...(this.scopes.get(assignmentId) ?? [])] };
  }

  public async insertAssignment(_exec: DbExecutor, input: NewAssignmentInput): Promise<string> {
    const id = crypto.randomUUID();
    const person = this.persons.get(input.personId);
    this.assignments.set(id, {
      id,
      personId: input.personId,
      personFullName: person?.fullName ?? "",
      role: input.role,
      financialRights: input.financialRights,
      registryExportRights: input.registryExportRights,
      regulationsRights: input.regulationsRights,
      status: "active",
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      scopeBuildingIds: [],
      assignedBy: input.assignedByPersonId,
      revokedBy: null,
      createdAt: iso(new Date()),
    });
    return id;
  }

  public async revokeAssignment(
    _exec: DbExecutor,
    assignmentId: string,
    revokedByPersonId: string,
  ): Promise<boolean> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment || assignment.status !== "active") return false;
    assignment.status = "revoked";
    assignment.revokedBy = revokedByPersonId;
    return true;
  }

  public async updateAssignmentFields(
    _exec: DbExecutor,
    assignmentId: string,
    patch: AssignmentFieldPatch,
  ): Promise<boolean> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment || assignment.status !== "active") return false;
    if (patch.financialRights !== undefined) assignment.financialRights = patch.financialRights;
    if (patch.registryExportRights !== undefined) assignment.registryExportRights = patch.registryExportRights;
    if (patch.regulationsRights !== undefined) assignment.regulationsRights = patch.regulationsRights;
    if (patch.validUntil !== undefined) assignment.validUntil = patch.validUntil;
    return true;
  }

  public async replaceAssignmentScope(
    _exec: DbExecutor,
    assignmentId: string,
    buildingIds: string[],
  ): Promise<void> {
    this.scopes.set(assignmentId, [...buildingIds]);
  }

  // ── Служебные сеансы ──────────────────────────────────────────────────────

  public async ensureAccessSession(
    _exec: DbExecutor,
    sessionId: string,
    profileId: string,
    now: Date,
  ): Promise<AccessSessionRecord> {
    const existing = this.sessions.get(sessionId);
    if (existing) return { ...existing };
    const session: AccessSessionRecord = {
      id: sessionId,
      profileId,
      startedAt: iso(now),
      lastActivityAt: iso(now),
      lastActivityKind: "start",
      revokedAt: null,
      revokedReason: null,
    };
    this.sessions.set(sessionId, session);
    return { ...session };
  }

  public async touchAccessSession(
    _exec: DbExecutor,
    sessionId: string,
    kind: string,
    now: Date,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt !== null) return;
    session.lastActivityAt = iso(now);
    session.lastActivityKind = kind;
  }

  public async getAccessSession(
    _exec: DbExecutor,
    sessionId: string,
  ): Promise<AccessSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  public async listAccessSessions(
    _exec: DbExecutor,
    filter: AccessSessionListFilter,
  ): Promise<AccessSessionListItem[]> {
    const profileName = new Map<string, { fullName: string; isTest: boolean }>();
    for (const profile of this.profiles.values()) {
      const person = this.persons.get(profile.personId);
      profileName.set(profile.id, { fullName: person?.fullName ?? "", isTest: person?.isTest ?? false });
    }
    return [...this.sessions.values()]
      .filter((s) => (filter.activeOnly ? s.revokedAt === null : true))
      .filter((s) => (filter.profileId !== undefined ? s.profileId === filter.profileId : true))
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))
      .slice(0, filter.limit)
      .map((s) => ({
        ...s,
        personFullName: profileName.get(s.profileId)?.fullName ?? "",
        personIsTest: profileName.get(s.profileId)?.isTest ?? false,
      }));
  }

  public async revokeAccessSession(
    _exec: DbExecutor,
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<AccessSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt !== null) return null;
    session.revokedAt = iso(now);
    session.revokedReason = reason;
    return { ...session };
  }

  public async revokeSessionsForPerson(
    _exec: DbExecutor,
    personId: string,
    reason: string,
    now: Date,
  ): Promise<number> {
    const profileIds = new Set(
      [...this.profiles.values()].filter((p) => p.personId === personId).map((p) => p.id),
    );
    let count = 0;
    for (const session of this.sessions.values()) {
      if (!profileIds.has(session.profileId) || session.revokedAt !== null) continue;
      session.revokedAt = iso(now);
      session.revokedReason = reason;
      count += 1;
    }
    return count;
  }
}

/** Фейк аудита. Список повторяет правила видимости isVisibleEntry (AUD-02). */
export class MemoryAuditRepo implements AuditRepo {
  public entries: AuditEntry[] = [];
  private nextId = 1;

  public async append(_exec: DbExecutor, input: AuditEntryInput): Promise<AuditEntry> {
    const entry: AuditEntry = {
      ...input,
      scopeBuildings: [...input.scopeBuildings],
      meta: { ...input.meta },
      id: this.nextId,
      at: new Date().toISOString(),
    };
    this.nextId += 1;
    this.entries.push(entry);
    return entry;
  }

  public async list(
    _exec: DbExecutor,
    filter: AuditListFilter,
    visibility: AuditVisibility,
  ): Promise<AuditPage> {
    let rows = this.entries.filter((entry) => isVisibleEntry(entry, visibility));
    if (filter.entityType !== undefined) rows = rows.filter((e) => e.entityType === filter.entityType);
    if (filter.entityId !== undefined) rows = rows.filter((e) => e.entityId === filter.entityId);
    if (filter.actorPersonId !== undefined) rows = rows.filter((e) => e.actorPersonId === filter.actorPersonId);
    if (filter.from !== undefined) rows = rows.filter((e) => e.at >= filter.from!);
    if (filter.to !== undefined) rows = rows.filter((e) => e.at <= filter.to!);
    rows = rows.sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1));
    if (filter.cursor !== undefined) {
      const cursor = decodeAuditCursor(filter.cursor);
      rows = rows.filter((e) => e.at < cursor.at || (e.at === cursor.at && e.id < cursor.id));
    }
    const page = rows.slice(0, filter.limit);
    const last = page[page.length - 1];
    return {
      entries: page,
      nextCursor: rows.length > filter.limit && last ? encodeAuditCursor(last) : null,
    };
  }
}

/** Фейк эмуляции: тестовые персоны с синтетикой и сеансы. */
export class MemoryEmulationRepo implements EmulationRepo {
  public readonly testPersons: TestPersonRecord[] = [];
  public readonly sessions = new Map<string, EmulationSessionRecord>();
  private seq = 0;

  public async listTestPersons(_exec: DbExecutor): Promise<TestPersonRecord[]> {
    return this.testPersons.map((record) => ({
      person: { ...record.person },
      profile: { ...record.profile },
    }));
  }

  public async createTestPerson(
    _exec: DbExecutor,
    input: { fullName: string },
  ): Promise<TestPersonRecord> {
    this.seq += 1;
    const person: PersonRecord = {
      id: crypto.randomUUID(),
      fullName: input.fullName,
      phoneE164: `+7${String(this.seq).padStart(11, "0")}`,
      status: "active",
      isTest: true,
      comment: "Тестовая персона (эмуляция)",
    };
    const profile: ProfileRecord = {
      id: crypto.randomUUID(),
      personId: person.id,
      telegramUserId: String(-this.seq),
      supabaseUserId: null,
      language: "ru",
      isTest: true,
      archivedAt: null,
    };
    this.testPersons.push({ person, profile });
    return { person: { ...person }, profile: { ...profile } };
  }

  public async getActiveSessionByTechProfile(
    _exec: DbExecutor,
    techAdminProfileId: string,
  ): Promise<EmulationSessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.techAdminProfileId === techAdminProfileId && session.state === "active") {
        return { ...session };
      }
    }
    return null;
  }

  public async getSession(
    _exec: DbExecutor,
    sessionId: string,
  ): Promise<EmulationSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  public async startSession(
    _exec: DbExecutor,
    input: { techAdminProfileId: string; emulatedProfileId: string },
    now: Date,
  ): Promise<EmulationSessionRecord> {
    const session: EmulationSessionRecord = {
      id: crypto.randomUUID(),
      techAdminProfileId: input.techAdminProfileId,
      emulatedProfileId: input.emulatedProfileId,
      startedAt: iso(now),
      endedAt: null,
      state: "active",
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  public async endSession(
    _exec: DbExecutor,
    sessionId: string,
    now: Date,
  ): Promise<EmulationSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "active") return null;
    session.state = "ended";
    session.endedAt = iso(now);
    return { ...session };
  }
}
