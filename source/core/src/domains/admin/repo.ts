// SQL-реализация порта администрирования (LLD-02 §2, §13). Запросы согласованы
// с миграцией 0003: область назначения собирается array_agg по staff_scope,
// отсутствие строк — пустой массив (весь ОСИ для chairman/tech_admin решает
// buildActor). timestamptz postgres.js возвращает Date — приводим к ISO-строке.

import type { DbExecutor } from "../../db/client.ts";
import type { AssignmentRow } from "../../pdp/actor.ts";
import type { StaffRole } from "../../pdp/types.ts";
import type { AccessSessionRecord } from "../../auth/session.ts";
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
} from "./port.ts";

interface ProfileRow {
  id: string;
  person_id: string;
  telegram_user_id: string | number;
  supabase_user_id: string | null;
  language: "ru" | "kk";
  is_test: boolean;
  archived_at: Date | string | null;
}

interface PersonRow {
  id: string;
  full_name: string;
  phone_e164: string;
  status: "active" | "archived";
  is_test: boolean;
  comment: string | null;
}

interface AssignmentScopeRow {
  id: string;
  role: StaffRole;
  financial_rights: boolean;
  registry_export_rights: boolean;
  regulations_rights: boolean;
  status: "active" | "revoked";
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  scope_building_ids: unknown;
}

interface AssignmentFullRow extends AssignmentScopeRow {
  person_id: string;
  person_full_name: string;
  assigned_by: string | null;
  revoked_by: string | null;
  created_at: Date | string;
}

interface SessionRow {
  id: string;
  profile_id: string;
  started_at: Date | string;
  last_activity_at: Date | string;
  last_activity_kind: string;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
}

interface SessionPersonRow extends SessionRow {
  person_full_name: string;
  person_is_test: boolean;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function asIdString(value: string | number): string {
  return String(value);
}

function asScope(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function mapProfile(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    personId: row.person_id,
    telegramUserId: asIdString(row.telegram_user_id),
    supabaseUserId: row.supabase_user_id,
    language: row.language,
    isTest: row.is_test,
    archivedAt: toIsoOrNull(row.archived_at),
  };
}

function mapPerson(row: PersonRow): PersonRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneE164: row.phone_e164,
    status: row.status,
    isTest: row.is_test,
    comment: row.comment,
  };
}

function mapAssignmentRow(row: AssignmentScopeRow): AssignmentRow {
  return {
    id: row.id,
    role: row.role,
    financialRights: row.financial_rights,
    registryExportRights: row.registry_export_rights,
    regulationsRights: row.regulations_rights,
    status: row.status,
    validFrom: toIsoOrNull(row.valid_from),
    validUntil: toIsoOrNull(row.valid_until),
    scopeBuildingIds: asScope(row.scope_building_ids),
  };
}

function mapAssignmentFull(row: AssignmentFullRow): AssignmentListRecord {
  return {
    ...mapAssignmentRow(row),
    personId: row.person_id,
    personFullName: row.person_full_name,
    assignedBy: row.assigned_by,
    revokedBy: row.revoked_by,
    createdAt: toIso(row.created_at),
  };
}

function mapSession(row: SessionRow): AccessSessionRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    startedAt: toIso(row.started_at),
    lastActivityAt: toIso(row.last_activity_at),
    lastActivityKind: row.last_activity_kind,
    revokedAt: toIsoOrNull(row.revoked_at),
    revokedReason: row.revoked_reason ?? undefined,
  };
}

const SESSION_COLUMNS =
  "id, profile_id, started_at, last_activity_at, last_activity_kind, revoked_at, revoked_reason";

const SESSION_COLUMNS_S =
  "s.id, s.profile_id, s.started_at, s.last_activity_at, s.last_activity_kind, s.revoked_at, s.revoked_reason";

/** Область назначения: строки staff_scope в uuid[]; без строк — пустой массив. */
const SCOPE_AGGREGATE =
  "coalesce(array_agg(ss.building_id) filter (where ss.building_id is not null), '{}') as scope_building_ids";

const ASSIGNMENT_SELECT = `
  select sa.id, sa.person_id, p.full_name as person_full_name, sa.role,
         sa.financial_rights, sa.registry_export_rights, sa.regulations_rights,
         sa.status, sa.valid_from, sa.valid_until, sa.assigned_by, sa.revoked_by,
         sa.created_at, ${SCOPE_AGGREGATE}
  from staff_assignment sa
  join person p on p.id = sa.person_id
  left join staff_scope ss on ss.assignment_id = sa.id`;

export class SqlAdminRepo implements AdminRepo {
  /** Только provider_id из закрытой auth.identities; metadata пользователя не используется. */
  public async linkProfileFromVerifiedIdentity(exec:DbExecutor,supabaseUserId:string):Promise<ProfileRecord|null> {
    const rows=await exec.query<ProfileRow>(`
      with linked as (
        update profile p set supabase_user_id=$1
        from auth.identities i
        where i.user_id=$1 and i.provider='custom:telegram'
          and i.provider_id=p.telegram_user_id::text
          and p.archived_at is null and p.supabase_user_id is null
          and not exists(select 1 from auth.identities other where other.user_id=i.user_id and other.id<>i.id)
        returning p.*
      ), logged as (
        insert into audit_log(actor_person_id,actor_profile_id,action,entity_type,entity_id,after)
        select person_id,id,'auth.telegram.link','profile',id,jsonb_build_object('supabase_user_id',supabase_user_id) from linked
      ) select * from linked`,[supabaseUserId]);
    return rows[0]?mapProfile(rows[0]):null;
  }

  public async findProfileBySupabaseUserId(
    exec: DbExecutor,
    supabaseUserId: string,
  ): Promise<ProfileRecord | null> {
    const rows = await exec.query<ProfileRow>(
      `select id, person_id, telegram_user_id, supabase_user_id, language, is_test, archived_at
       from profile
       where supabase_user_id = $1 and archived_at is null
       limit 1`,
      [supabaseUserId],
    );
    const row = rows[0];
    return row ? mapProfile(row) : null;
  }

  public async getPerson(exec: DbExecutor, personId: string): Promise<PersonRecord | null> {
    const rows = await exec.query<PersonRow>(
      "select id, full_name, phone_e164, status, is_test, comment from person where id = $1",
      [personId],
    );
    const row = rows[0];
    return row ? mapPerson(row) : null;
  }

  public async getProfile(exec: DbExecutor, profileId: string): Promise<ProfileRecord | null> {
    const rows = await exec.query<ProfileRow>(
      "select id, person_id, telegram_user_id, supabase_user_id, language, is_test, archived_at from profile where id = $1",
      [profileId],
    );
    const row = rows[0];
    return row ? mapProfile(row) : null;
  }

  public async listPersonsLookup(
    exec: DbExecutor,
    query: string,
    limit: number,
  ): Promise<PersonLookupRecord[]> {
    const rows = await exec.query<PersonRow & { is_test: boolean }>(
      `select id, full_name, phone_e164, status, is_test, comment
       from person
       where status = 'active' and (full_name ilike $1 or phone_e164 ilike $1)
       order by full_name asc
       limit $2`,
      [`%${query}%`, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phoneE164: row.phone_e164,
      isTest: row.is_test,
    }));
  }

  public async listActiveAssignments(exec: DbExecutor, personId: string): Promise<AssignmentRow[]> {
    const rows = await exec.query<AssignmentScopeRow>(
      `select sa.id, sa.role, sa.financial_rights, sa.registry_export_rights,
              sa.regulations_rights, sa.status, sa.valid_from, sa.valid_until, ${SCOPE_AGGREGATE}
       from staff_assignment sa
       left join staff_scope ss on ss.assignment_id = sa.id
       where sa.person_id = $1 and sa.status = 'active'
       group by sa.id`,
      [personId],
    );
    return rows.map(mapAssignmentRow);
  }

  public async listAssignments(
    exec: DbExecutor,
    filter: AssignmentListFilter,
  ): Promise<AssignmentListRecord[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.activeOnly) {
      where.push("sa.status = 'active'");
    }
    params.push(filter.limit);
    const limitParam = params.length;
    const rows = await exec.query<AssignmentFullRow>(
      `${ASSIGNMENT_SELECT}
       ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
       group by sa.id, p.full_name
       order by sa.created_at desc
       limit $${limitParam}`,
      params,
    );
    return rows.map(mapAssignmentFull);
  }

  public async getAssignment(
    exec: DbExecutor,
    assignmentId: string,
  ): Promise<AssignmentListRecord | null> {
    const rows = await exec.query<AssignmentFullRow>(
      `${ASSIGNMENT_SELECT}
       where sa.id = $1
       group by sa.id, p.full_name
       limit 1`,
      [assignmentId],
    );
    const row = rows[0];
    return row ? mapAssignmentFull(row) : null;
  }

  public async insertAssignment(exec: DbExecutor, input: NewAssignmentInput): Promise<string> {
    const rows = await exec.query<{ id: string }>(
      `insert into staff_assignment
         (person_id, role, financial_rights, registry_export_rights, regulations_rights,
          valid_from, valid_until, assigned_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        input.personId,
        input.role,
        input.financialRights,
        input.registryExportRights,
        input.regulationsRights,
        input.validFrom,
        input.validUntil,
        input.assignedByPersonId,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("staff_assignment: вставка не вернула идентификатор");
    return row.id;
  }

  public async revokeAssignment(
    exec: DbExecutor,
    assignmentId: string,
    revokedByPersonId: string,
  ): Promise<boolean> {
    const rows = await exec.query<{ id: string }>(
      `update staff_assignment set status = 'revoked', revoked_by = $2
       where id = $1 and status = 'active'
       returning id`,
      [assignmentId, revokedByPersonId],
    );
    return rows.length > 0;
  }

  public async updateAssignmentFields(
    exec: DbExecutor,
    assignmentId: string,
    patch: AssignmentFieldPatch,
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.financialRights !== undefined) set("financial_rights", patch.financialRights);
    if (patch.registryExportRights !== undefined) set("registry_export_rights", patch.registryExportRights);
    if (patch.regulationsRights !== undefined) set("regulations_rights", patch.regulationsRights);
    if (patch.validUntil !== undefined) set("valid_until", patch.validUntil);
    if (sets.length === 0) return true;

    params.push(assignmentId);
    const rows = await exec.query<{ id: string }>(
      `update staff_assignment set ${sets.join(", ")}
       where id = $${params.length} and status = 'active'
       returning id`,
      params,
    );
    return rows.length > 0;
  }

  public async replaceAssignmentScope(
    exec: DbExecutor,
    assignmentId: string,
    buildingIds: string[],
  ): Promise<void> {
    await exec.query("delete from staff_scope where assignment_id = $1", [assignmentId]);
    if (buildingIds.length > 0) {
      await exec.query(
        `insert into staff_scope (assignment_id, building_id)
         select $1, building_id from unnest($2::uuid[]) as building_id`,
        [assignmentId, buildingIds],
      );
    }
  }

  public async ensureAccessSession(
    exec: DbExecutor,
    sessionId: string,
    profileId: string,
    now: Date,
  ): Promise<AccessSessionRecord> {
    const inserted = await exec.query<SessionRow>(
      `insert into access_session (id, profile_id, started_at, last_activity_at, last_activity_kind)
       values ($1, $2, $3, $3, 'start')
       on conflict (id) do nothing
       returning ${SESSION_COLUMNS}`,
      [sessionId, profileId, now.toISOString()],
    );
    const row = inserted[0];
    if (row) return mapSession(row);
    const existing = await this.getAccessSession(exec, sessionId);
    if (!existing) throw new Error("access_session: повторное чтение не нашло сеанс");
    return existing;
  }

  public async touchAccessSession(
    exec: DbExecutor,
    sessionId: string,
    kind: string,
    now: Date,
  ): Promise<void> {
    await exec.query(
      "update access_session set last_activity_at = $2, last_activity_kind = $3 where id = $1 and revoked_at is null",
      [sessionId, now.toISOString(), kind],
    );
  }

  public async getAccessSession(exec: DbExecutor, sessionId: string): Promise<AccessSessionRecord | null> {
    const rows = await exec.query<SessionRow>(
      `select ${SESSION_COLUMNS} from access_session where id = $1`,
      [sessionId],
    );
    const row = rows[0];
    return row ? mapSession(row) : null;
  }

  public async listAccessSessions(
    exec: DbExecutor,
    filter: AccessSessionListFilter,
  ): Promise<AccessSessionListItem[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.activeOnly) {
      where.push("s.revoked_at is null");
    }
    if (filter.profileId !== undefined) {
      params.push(filter.profileId);
      where.push(`s.profile_id = $${params.length}`);
    }
    params.push(filter.limit);
    const limitParam = params.length;
    const rows = await exec.query<SessionPersonRow>(
      `select ${SESSION_COLUMNS_S},
              p.full_name as person_full_name, p.is_test as person_is_test
       from access_session s
       join profile pr on pr.id = s.profile_id
       join person p on p.id = pr.person_id
       ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
       order by s.last_activity_at desc
       limit $${limitParam}`,
      params,
    );
    return rows.map((row) => ({
      ...mapSession(row),
      personFullName: row.person_full_name,
      personIsTest: row.person_is_test,
    }));
  }

  public async revokeAccessSession(
    exec: DbExecutor,
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<AccessSessionRecord | null> {
    const rows = await exec.query<SessionRow>(
      `update access_session set revoked_at = $2, revoked_reason = $3
       where id = $1 and revoked_at is null
       returning ${SESSION_COLUMNS}`,
      [sessionId, now.toISOString(), reason],
    );
    const row = rows[0];
    return row ? mapSession(row) : null;
  }

  public async revokeSessionsForPerson(
    exec: DbExecutor,
    personId: string,
    reason: string,
    now: Date,
  ): Promise<number> {
    const rows = await exec.query<{ id: string }>(
      `update access_session s
       set revoked_at = $2, revoked_reason = $3
       from profile pr
       where s.profile_id = pr.id and pr.person_id = $1 and s.revoked_at is null
       returning s.id`,
      [personId, now.toISOString(), reason],
    );
    return rows.length;
  }
}
