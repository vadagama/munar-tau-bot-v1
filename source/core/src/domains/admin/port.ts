// Порт домена администрирования (LLD-02 §2, §13): профили, персоны,
// назначения с областью, служебные сеансы. Реализации: SQL — repo.ts,
// in-memory — core/src/testing/memory.ts. Все методы принимают DbExecutor
// первым аргументом, чтобы сервисы могли исполнять их внутри транзакции.

import type { AccessSessionRecord } from "../../auth/session.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { AssignmentRow } from "../../pdp/actor.ts";
import type { StaffRole } from "../../pdp/types.ts";

export type { AssignmentRow } from "../../pdp/actor.ts";
export type { AccessSessionRecord } from "../../auth/session.ts";

/** Персона (LLD-02 §2.1). */
export interface PersonRecord {
  id: string;
  fullName: string;
  phoneE164: string;
  status: "active" | "archived";
  isTest: boolean;
  comment: string | null;
}

/** Профиль — привязка Telegram/Supabase (LLD-02 §2.2). */
export interface ProfileRecord {
  id: string;
  personId: string;
  /** telegram_user_id — bigint из БД приходит строкой. */
  telegramUserId: string;
  supabaseUserId: string | null;
  language: "ru" | "kk";
  isTest: boolean;
  archivedAt: string | null;
}

/** Назначение со сведениями персоны — для списков и аудита. */
export interface AssignmentListRecord extends AssignmentRow {
  personId: string;
  personFullName: string;
  assignedBy: string | null;
  revokedBy: string | null;
  createdAt: string;
}

/** Вход создания назначения (ROL-02). */
export interface NewAssignmentInput {
  personId: string;
  role: StaffRole;
  financialRights: boolean;
  registryExportRights: boolean;
  regulationsRights: boolean;
  validFrom: string | null;
  validUntil: string | null;
  /** Область домов; пустой массив — весь ОСИ (только chairman/tech_admin). */
  scopeBuildingIds: string[];
  assignedByPersonId: string;
}

/**
 * Правка назначения. undefined — поле не менять; validUntil: null — снять срок.
 * Область правится через replaceAssignmentScope (отдельный вызов в транзакции).
 */
export interface AssignmentFieldPatch {
  financialRights?: boolean;
  registryExportRights?: boolean;
  regulationsRights?: boolean;
  validUntil?: string | null;
}

export interface AssignmentListFilter {
  activeOnly: boolean;
  personId?: string;
  limit: number;
}

/** Сеанс со сведениями персоны — для списка сеансов (LLD-03 §3). */
export interface AccessSessionListItem extends AccessSessionRecord {
  personFullName: string;
  personIsTest: boolean;
}

export interface AccessSessionListFilter {
  activeOnly: boolean;
  profileId?: string;
  limit: number;
}

/** Строка поиска персоны (IMP-05: минимум данных для выбора). */
export interface PersonLookupRecord {
  id: string;
  fullName: string;
  phoneE164: string;
  isTest: boolean;
}

export interface AdminRepo {
  listBuildingIds?(exec: DbExecutor): Promise<string[]>;
  lockPerson(exec: DbExecutor, personId: string): Promise<PersonRecord | null>;
  hasActiveProfile(exec: DbExecutor, personId: string): Promise<boolean>;
  // Профили и персоны
  linkProfileFromVerifiedIdentity?(exec: DbExecutor, supabaseUserId: string): Promise<ProfileRecord | null>;
  findProfileBySupabaseUserId(exec: DbExecutor, supabaseUserId: string): Promise<ProfileRecord | null>;
  getPerson(exec: DbExecutor, personId: string): Promise<PersonRecord | null>;
  getProfile(exec: DbExecutor, profileId: string): Promise<ProfileRecord | null>;
  listPersonsLookup(exec: DbExecutor, query: string, limit: number): Promise<PersonLookupRecord[]>;

  // Назначения
  listActiveAssignments(exec: DbExecutor, personId: string): Promise<AssignmentRow[]>;
  listAssignments(exec: DbExecutor, filter: AssignmentListFilter): Promise<AssignmentListRecord[]>;
  getAssignment(exec: DbExecutor, assignmentId: string): Promise<AssignmentListRecord | null>;
  /** Создаёт назначение, возвращает его идентификатор. */
  insertAssignment(exec: DbExecutor, input: NewAssignmentInput): Promise<string>;
  /** Отзывает активное назначение; false — не найдено или уже отозвано. */
  revokeAssignment(exec: DbExecutor, assignmentId: string, revokedByPersonId: string): Promise<boolean>;
  /** Правит поля активного назначения; false — не найдено или не активно. */
  updateAssignmentFields(exec: DbExecutor, assignmentId: string, patch: AssignmentFieldPatch): Promise<boolean>;
  /** Заменяет область назначения (внутри транзакции с правкой полей). */
  replaceAssignmentScope(exec: DbExecutor, assignmentId: string, buildingIds: string[]): Promise<void>;

  // Служебные сеансы (LLD-02 §13, AUTH-06)
  /** Создаёт сеанс, если его ещё нет; возвращает запись (существующую или новую). */
  ensureAccessSession(exec: DbExecutor, sessionId: string, profileId: string, now: Date): Promise<AccessSessionRecord>;
  /** Продлевает активность сеанса; отозванный сеанс не трогает. */
  touchAccessSession(exec: DbExecutor, sessionId: string, kind: string, now: Date): Promise<void>;
  getAccessSession(exec: DbExecutor, sessionId: string): Promise<AccessSessionRecord | null>;
  listAccessSessions(exec: DbExecutor, filter: AccessSessionListFilter): Promise<AccessSessionListItem[]>;
  /** Отзывает активный сеанс; null — не найден или уже отозван. */
  revokeAccessSession(exec: DbExecutor, sessionId: string, reason: string, now: Date): Promise<AccessSessionRecord | null>;
  /** Отзывает все активные сеансы персоны (при отзыве назначения, ROL-04). */
  revokeSessionsForPerson(exec: DbExecutor, personId: string, reason: string, now: Date): Promise<number>;
}
