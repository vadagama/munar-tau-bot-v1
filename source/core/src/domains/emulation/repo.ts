// SQL-реализация порта эмуляции (HLD 10.8, миграция 0003). Синтетические
// идентификаторы тестовых персон берутся из последовательности
// emulation_test_phone_seq: телефон +7000000000NN, telegram id отрицательный —
// реальным данным не соответствуют.

import type { DbExecutor } from "../../db/client.ts";
import type {
  EmulationRepo,
  EmulationSessionRecord,
  TestPersonRecord,
} from "./port.ts";
import type { PersonRecord, ProfileRecord } from "../admin/port.ts";

interface PersonRow {
  id: string;
  full_name: string;
  phone_e164: string;
  status: "active" | "archived";
  is_test: boolean;
  comment: string | null;
}

interface ProfileRow {
  id: string;
  person_id: string;
  telegram_user_id: string | number;
  supabase_user_id: string | null;
  language: "ru" | "kk";
  is_test: boolean;
  archived_at: Date | string | null;
}

interface TestPersonFlatRow {
  person_id: string;
  full_name: string;
  phone_e164: string;
  person_status: "active" | "archived";
  person_is_test: boolean;
  comment: string | null;
  profile_id: string;
  telegram_user_id: string | number;
  supabase_user_id: string | null;
  language: "ru" | "kk";
  profile_is_test: boolean;
  archived_at: Date | string | null;
}

interface SessionRow {
  id: string;
  tech_admin_profile_id: string;
  emulated_profile_id: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  state: "active" | "ended";
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function mapProfile(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    personId: row.person_id,
    telegramUserId: String(row.telegram_user_id),
    supabaseUserId: row.supabase_user_id,
    language: row.language,
    isTest: row.is_test,
    archivedAt: row.archived_at === null ? null : toIso(row.archived_at),
  };
}

function mapSession(row: SessionRow): EmulationSessionRecord {
  return {
    id: row.id,
    techAdminProfileId: row.tech_admin_profile_id,
    emulatedProfileId: row.emulated_profile_id,
    startedAt: toIso(row.started_at),
    endedAt: row.ended_at === null ? null : toIso(row.ended_at),
    state: row.state,
  };
}

const SESSION_COLUMNS =
  "id, tech_admin_profile_id, emulated_profile_id, started_at, ended_at, state";

export class SqlEmulationRepo implements EmulationRepo {
  public async listTestPersons(exec: DbExecutor): Promise<TestPersonRecord[]> {
    const rows = await exec.query<TestPersonFlatRow>(
      `select pe.id as person_id, pe.full_name, pe.phone_e164,
              pe.status as person_status, pe.is_test as person_is_test, pe.comment,
              pr.id as profile_id, pr.telegram_user_id, pr.supabase_user_id,
              pr.language, pr.is_test as profile_is_test, pr.archived_at
       from person pe
       join profile pr on pr.person_id = pe.id and pr.archived_at is null
       where pe.is_test
       order by pe.created_at desc
       limit 200`,
    );
    return rows.map((row) => ({
      person: mapPerson({
        id: row.person_id,
        full_name: row.full_name,
        phone_e164: row.phone_e164,
        status: row.person_status,
        is_test: row.person_is_test,
        comment: row.comment,
      }),
      profile: mapProfile({
        id: row.profile_id,
        person_id: row.person_id,
        telegram_user_id: row.telegram_user_id,
        supabase_user_id: row.supabase_user_id,
        language: row.language,
        is_test: row.profile_is_test,
        archived_at: row.archived_at,
      }),
    }));
  }

  public async createTestPerson(
    exec: DbExecutor,
    input: { fullName: string },
  ): Promise<TestPersonRecord> {
    const personRows = await exec.query<PersonRow>(
      `insert into person (full_name, phone_e164, is_test, comment)
       values ($1, '+7' || lpad(nextval('emulation_test_phone_seq')::text, 11, '0'), true,
               'Тестовая персона (эмуляция)')
       returning id, full_name, phone_e164, status, is_test, comment`,
      [input.fullName],
    );
    const personRow = personRows[0];
    if (!personRow) throw new Error("person: вставка тестовой персоны не вернула запись");

    const profileRows = await exec.query<ProfileRow>(
      `insert into profile (person_id, telegram_user_id, is_test)
       values ($1, -nextval('emulation_test_phone_seq')::bigint, true)
       returning id, person_id, telegram_user_id, supabase_user_id, language, is_test, archived_at`,
      [personRow.id],
    );
    const profileRow = profileRows[0];
    if (!profileRow) throw new Error("profile: вставка тестового профиля не вернула запись");

    return { person: mapPerson(personRow), profile: mapProfile(profileRow) };
  }

  public async getActiveSessionByTechProfile(
    exec: DbExecutor,
    techAdminProfileId: string,
  ): Promise<EmulationSessionRecord | null> {
    const rows = await exec.query<SessionRow>(
      `select ${SESSION_COLUMNS} from emulation_session
       where tech_admin_profile_id = $1 and state = 'active'`,
      [techAdminProfileId],
    );
    const row = rows[0];
    return row ? mapSession(row) : null;
  }

  public async getSession(exec: DbExecutor, sessionId: string): Promise<EmulationSessionRecord | null> {
    const rows = await exec.query<SessionRow>(
      `select ${SESSION_COLUMNS} from emulation_session where id = $1`,
      [sessionId],
    );
    const row = rows[0];
    return row ? mapSession(row) : null;
  }

  public async startSession(
    exec: DbExecutor,
    input: { techAdminProfileId: string; emulatedProfileId: string },
    now: Date,
  ): Promise<EmulationSessionRecord> {
    const rows = await exec.query<SessionRow>(
      `insert into emulation_session (tech_admin_profile_id, emulated_profile_id, started_at)
       values ($1, $2, $3)
       returning ${SESSION_COLUMNS}`,
      [input.techAdminProfileId, input.emulatedProfileId, now.toISOString()],
    );
    const row = rows[0];
    if (!row) throw new Error("emulation_session: вставка не вернула запись");
    return mapSession(row);
  }

  public async endSession(
    exec: DbExecutor,
    sessionId: string,
    now: Date,
  ): Promise<EmulationSessionRecord | null> {
    const rows = await exec.query<SessionRow>(
      `update emulation_session set state = 'ended', ended_at = $2
       where id = $1 and state = 'active'
       returning ${SESSION_COLUMNS}`,
      [sessionId, now.toISOString()],
    );
    const row = rows[0];
    return row ? mapSession(row) : null;
  }
}
