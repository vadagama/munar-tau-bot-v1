// Типы PDP — единственного способа проверки доступа (LLD-01 §3.1, ROL-01).
// Actor собирается репозиторием на каждый запрос: проверка отзыва и срока
// полномочий выполняется при сборке, оценка can() — детерминированная.

/** Роль сотрудника (enum staff_role, LLD-02 §2.6). Роль назначается, не выбирается. */
export type StaffRole =
  | "administrator"
  | "deputy"
  | "chairman"
  | "tech_admin"
  | "duty"
  | "doc_reviewer"
  | "finance"
  | "executor";

/** Все роли — для словарей UI и валидации входа (соответствует enum staff_role). */
export const STAFF_ROLES: readonly StaffRole[] = [
  "administrator",
  "deputy",
  "chairman",
  "tech_admin",
  "duty",
  "doc_reviewer",
  "finance",
  "executor",
];

/** Спецправа назначения (ROL-02b, IMP-05, TIM-03). Выдаёт только председатель. */
export interface SpecialRights {
  financialRights: boolean;
  registryExportRights: boolean;
  regulationsRights: boolean;
}

/** Действующее назначение: отзыв и окно (ROL-03) проверены при сборке Actor. */
export interface ActorAssignment extends SpecialRights {
  inherited?: boolean;
  id: string;
  role: StaffRole;
  /**
   * Область домов. undefined — весь ОСИ: отсутствие строк staff_scope
   * допускается только у chairman/tech_admin (согласовано 16.10.2026).
   * Пустой массив — область не назначена: действий по области нет.
   */
  scopeBuildingIds: string[] | undefined;
}

/** Персона (LLD-02 §2.1). */
export interface ActorPerson {
  id: string;
  fullName: string;
  status: "active" | "archived";
  isTest: boolean;
}

/** Профиль — привязка Telegram/Supabase (LLD-02 §2.2). */
export interface ActorProfile {
  id: string;
  personId: string;
  language: "ru" | "kk";
  isTest: boolean;
}

/** Активная эмуляция (HLD 10.8): права оцениваются по эмулируемой персоне,
 * журнал ссылается на реального актора. */
export interface ActorEmulation {
  sessionId: string;
  /** Реальный актор — техадминистратор. */
  realPersonId: string;
  realProfileId: string;
}

/** Actor — вход PDP (LLD-01 §3.1). Связи и участие добавляются в VS-2/VS-3. */
export interface Actor {
  assignedRoles?: StaffRole[];
  globalStaff?: boolean;
  profile: ActorProfile;
  person: ActorPerson;
  assignments: ActorAssignment[];
  emulation: ActorEmulation | null;
}

/** Ссылка на ресурс проверки (минимум для действий VS-1). */
export interface ResourceRef {
  documentAccess?: {
    buildingIds: string[]; isTest: boolean;
    audience: "resident" | "owner" | "staff" | "finance" | "service";
    published: boolean; member: boolean; owner: boolean;
    sourceAllowed: boolean; sourceManageable: boolean;
    preparedById: string; reviewerId: string;
    assignedTask: boolean; resultAuthorIds: string[];
    reviewSource?: { isTest: boolean; draft: boolean; chairmanOnly: boolean; complaintSubjectId: string | null };
  };
  incidentAccess?: { buildingIds: string[]; isTest: boolean; responsibleId: string | null; member: boolean; published: boolean };
  publicationAccess?: { buildingIds: string[]; isTest: boolean; member: boolean; published: boolean };
  taskAccess?: { buildingIds: string[]; assigneeId: string | null; isTest: boolean };
  requestAccess?: { chairmanOnly?: boolean; authorId: string; buildingId: string | null; state: string; isTest: boolean; participant: boolean; activeAuthor: boolean; complaintSubjectId: string | null };
  kind?: "audit" | "assignment" | "access_session" | "person" | "emulation";
  id?: string;
  /** Владелец сеанса — проверка «собственный сеанс» (AUTH-06). */
  profileId?: string;
  /** Область ресурса (дома). */
  buildingIds?: string[];
  /** Для мутаций назначений: целевая роль. */
  targetRole?: StaffRole;
  /** Для мутаций назначений: выдаются ли спецправа (ROL-02b). */
  targetSpecialRights?: boolean;
  /** Для мутаций назначений: срок полномочий (ROL-03). */
  targetValidUntil?: string | null;
}

/** Решение PDP (LLD-01 §3.1). Отказ всегда с причиной — она попадает в журнал. */
export type Decision =
  | { allow: true }
  | { allow: false; reason: string; code: "FORBIDDEN" };

export const ALLOW: Decision = { allow: true };

export function deny(reason: string): Decision {
  return { allow: false, reason, code: "FORBIDDEN" };
}
