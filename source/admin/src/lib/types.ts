// Типы ответов функции api — JSON API в snake_case (LLD-03 §4.1, решения VS-1).
// Сверяйте с functions/api/handlers.ts при изменении контрактов.

export interface MeAssignment {
  id: string;
  role: string;
  financial_rights: boolean;
  registry_export_rights: boolean;
  regulations_rights: boolean;
  /** null — весь ОСИ (ROL-02a); массив — дома области. */
  scope_building_ids: string[] | null;
}

export interface MeResponse {
  effective_roles?: string[];
  assigned_roles?: string[];
  profile: {
    id: string;
    person_id: string;
    language: "ru" | "kk";
    is_test: boolean;
  };
  person: {
    id: string;
    full_name: string;
    status: string;
    is_test: boolean;
  };
  assignments: MeAssignment[];
  session: {
    id: string;
    started_at: string;
    last_activity_at: string;
    total_limit_seconds: number;
    idle_limit_seconds: number;
  };
  emulation: {
    session_id: string;
    real_person_id: string;
    real_profile_id: string;
    real_person_full_name: string;
  } | null;
}

export interface AuditEntryJson {
  id: number;
  at: string;
  actor_person_id: string | null;
  actor_profile_id: string | null;
  emulation_session_id: string | null;
  emulated_person_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  scope_buildings: string[];
  meta: Record<string, unknown>;
}

export interface AuditListResponse {
  entries: AuditEntryJson[];
  next_cursor: string | null;
}

export interface AssignmentJson {
  id: string;
  person_id: string;
  person_full_name: string;
  role: string;
  financial_rights: boolean;
  registry_export_rights: boolean;
  regulations_rights: boolean;
  status: "active" | "revoked";
  valid_from: string | null;
  valid_until: string | null;
  scope_building_ids: string[];
  assigned_by: string | null;
  revoked_by: string | null;
  created_at: string;
}

export interface PersonLookupResponse {
  persons: Array<{
    id: string;
    full_name: string;
    phone_e164: string;
    is_test: boolean;
  }>;
}

export interface SessionJson {
  id: string;
  profile_id: string;
  started_at: string;
  last_activity_at: string;
  last_activity_kind: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  person_full_name?: string;
  person_is_test?: boolean;
}

export interface SessionsResponse {
  sessions: SessionJson[];
}

export interface EmulationPersonJson {
  person: {
    id: string;
    full_name: string;
    phone_e164: string;
    status: string;
  };
  profile: {
    id: string;
    telegram_user_id: string;
    language: string;
  };
  assignments: Array<{
    id: string;
    role: string;
    scope_building_ids: string[];
    status: string;
  }>;
}

export interface EmulationPersonsResponse {
  persons: EmulationPersonJson[];
}

export interface EmulationSessionJson {
  id: string;
  tech_admin_profile_id: string;
  emulated_profile_id: string;
  started_at: string;
  ended_at: string | null;
  state: "active" | "ended";
}

export interface EmulationSessionResponse {
  session: EmulationSessionJson;
}

// ── AI-ассистент (ADR-021, план S0.4) ──────────────────────────────────────

/** Singleton настроек ассистента: токен — только маской. */
export interface AssistantSettingsJson {
  settings: {
    provider: string;
    base_url: string;
    model_id: string;
    api_key_mask: string | null;
    version: number;
  } | null;
  users: AssistantUserRowJson[];
}

/** Строка списка сотрудников с per-user конфигом. */
export interface AssistantUserRowJson {
  person_id: string;
  profile_id: string | null;
  full_name: string;
  roles: string[];
  telegram_username: string | null;
  enabled: boolean;
  daily_token_limit: number;
  monthly_token_limit: number;
  /** null — конфига нет: сохранение такой строки выполняет insert. */
  version: number | null;
}

/** Свой доступ и остаток (GET /v1/assistant/settings/me). */
export interface AssistantAccessJson {
  enabled: boolean;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  day_used: number;
  month_used: number;
  day: string;
  month: string;
}
