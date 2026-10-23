// Реестр действий PDP — единый источник требований (LLD-01 §3.1, §6).
// Новая операция добавляется сюда; privileged-действия (AUTH-03) доступны
// только через кабинет и запрещены в эмуляции.

import { STAFF_ROLES, type SpecialRights, type StaffRole } from "./types.ts";

export type ActionKey =
  | "moderation.read" | "moderation.appeal" | "moderation.resolve"
  | "report.requests" | "report.tasks" | "report.incidents" | "report.payments" | "report.export" | "report.configure"
  | "initiative.attach" | "initiative.use" | "initiative.create" | "initiative.read" | "initiative.manage" | "initiative.support" | "initiative.comment" | "initiative.moderate"
  | "poll.use" | "poll.read" | "poll.manage" | "poll.answer" | "poll.results"
  | "document.use" | "document.read" | "document.prepare" | "document.review" | "document.manage" | "document.obligations"
  | "staff.read" | "staff.edit"
  | "settings.templates.read" | "settings.templates.edit"
  | "incident.use" | "incident.read" | "incident.manage" | "incident.link"
  | "publication.read" | "publication.manage" | "publication.approve"
  | "notification.preferences"
  | "notification.failures"
  | "task.use"
  | "task.read"
  | "task.manage"
  | "task.execute"
  | "request.use"
  | "request.read"
  | "request.manage"
  | "request.internal"
  | "request.author"
  | "request.comment"
  | "request.category.edit"
  | "registry.telegram.recovery"
  | "registry.rules.read"
  | "registry.rules.edit"
  | "registry.read"
  | "registry.write"
  | "registry.export"
  | "registration.self"
  | "registration.review"
  | "registration.manage"
  | "privacy.request"
  | "meta.me"
  | "meta.dictionary"
  | "audit.read"
  | "admin.persons.lookup"
  | "admin.assignment.list"
  | "admin.assignment.create"
  | "admin.assignment.update"
  | "admin.session.list"
  | "admin.session.revoke"
  | "emulation.person.list"
  | "emulation.person.create"
  | "emulation.person.role.revoke"
  | "emulation.session.start"
  | "emulation.session.end"
  | "emulation.simulate";

export interface ActionSpec {
  /** AUTH-03: кабинет-only; после пилота — дополнительно TOTP (AQ-02). */
  privileged: boolean;
  /** Требуемая роль из действующих назначений; undefined — любой с профилем. */
  roles?: readonly StaffRole[];
  /** Обязательные спецправа (ROL-02b). */
  requiresRights?: Partial<SpecialRights>;
  /** Собственный ресурс разрешён помимо ролей (свой сеанс — AUTH-06). */
  allowOwn?: boolean;
}

export const ACTIONS: Readonly<Record<ActionKey, ActionSpec>> = {
  "moderation.read": {privileged:false},
  "moderation.appeal": {privileged:false},
  "moderation.resolve": {privileged:false},
  "report.requests": { privileged: false },
  "report.tasks": { privileged: false },
  "report.incidents": { privileged: false },
  "report.payments": { privileged: false },
  "report.export": { privileged: false },
  "report.configure": { privileged: true },
  "initiative.attach": { privileged: false },
  "initiative.use": { privileged: false },
  "initiative.create": { privileged: false },
  "initiative.read": { privileged: false },
  "initiative.manage": { privileged: false },
  "initiative.support": { privileged: false },
  "initiative.comment": { privileged: false },
  "initiative.moderate": { privileged: false },
  "poll.use": { privileged: false },
  "poll.read": { privileged: false },
  "poll.manage": { privileged: false },
  "poll.answer": { privileged: false },
  "poll.results": { privileged: false },
  "document.use": { privileged: false },
  "document.obligations": { privileged: false },
  "document.read": { privileged: false },
  "document.prepare": { privileged: false },
  "document.review": { privileged: false },
  "document.manage": { privileged: false },
  "staff.read": { privileged:false, roles:["chairman","administrator","deputy"] },
  "staff.edit": { privileged:true, roles:["chairman","administrator","deputy"] },
  "settings.templates.read": {privileged:false,roles:["chairman","administrator","tech_admin"]},
  "settings.templates.edit": {privileged:true,roles:["chairman","administrator","tech_admin"]},
  "incident.use": { privileged: false },
  "incident.read": { privileged: false },
  "incident.manage": { privileged: false },
  "incident.link": { privileged: false },
  "publication.read": { privileged: false },
  "publication.manage": { privileged: false },
  "publication.approve": { privileged: false },
  "notification.preferences": { privileged: false },
  "notification.failures": { privileged: false, roles: ["chairman", "administrator", "deputy"] },
  "task.use": { privileged: false, roles: STAFF_ROLES },
  "task.read": { privileged: false },
  "task.manage": { privileged: false },
  "task.execute": { privileged: false },
  "request.use": { privileged: false },
  "request.read": { privileged: false },
  "request.manage": { privileged: false },
  "request.internal": { privileged: false },
  "request.author": { privileged: false },
  "request.comment": { privileged: false },
  "request.category.edit": { privileged: true, roles: ["chairman", "administrator", "deputy"] },
  "registry.telegram.recovery": { privileged: true, roles: ["chairman", "administrator", "tech_admin"] },
  "registry.rules.read": { privileged: false, roles: ["chairman", "administrator", "tech_admin"] },
  "registry.rules.edit": { privileged: true, roles: ["chairman", "administrator", "tech_admin"] },
  "registry.read": { privileged: false, roles: ["chairman", "administrator", "deputy"] },
  "registry.write": { privileged: false, roles: ["chairman", "administrator", "deputy"] },
  "registry.export": { privileged: true, roles: ["chairman", "administrator" ] },
  "registration.self": { privileged: false },
  "registration.review": { privileged: false, roles: ["chairman", "administrator", "deputy", "tech_admin"] },
  "registration.manage": { privileged: true, roles: ["chairman", "administrator", "deputy", "tech_admin"] },
  // PRV-02: запрос удаления профиля/отзыва согласия подаёт сам житель.
  "privacy.request": { privileged: false },
  "meta.me": { privileged: false },
  "meta.dictionary": { privileged: false },

  // AUD-01/02: журнал — председатель (всё), администратор (свои дома),
  // техадмин (технические события); область строк фильтрует домен audit.
  "audit.read": { privileged: false, roles: ["chairman", "administrator", "tech_admin"] },

  "admin.persons.lookup": { privileged: false, roles: ["chairman", "administrator"] },
  "admin.assignment.list": { privileged: false, roles: ["chairman", "administrator"] },

  // ROL-02: назначение ролей; ROL-02b: спецправа — только председатель.
  "admin.assignment.create": { privileged: true, roles: ["chairman", "administrator"] },
  "admin.assignment.update": { privileged: true, roles: ["chairman", "administrator"] },

  // Сеансы: председатель/техадмин; свой сеанс может завершить каждый (AUTH-06).
  "admin.session.list": { privileged: false, roles: ["chairman", "tech_admin"] },
  "admin.session.revoke": { privileged: false, roles: ["chairman", "tech_admin"], allowOwn: true },

  // Эмуляция — только техадмин, только тестовые персоны (HLD 10.8).
  "emulation.person.list": { privileged: false, roles: ["tech_admin"] },
  "emulation.person.create": { privileged: false, roles: ["tech_admin"] },
  // Снятие роли с тестовой персоны — управление пилотом эмуляции реальным
  // техадмином (не эмулированной персоной); выдача ролей остаётся у председателя.
  "emulation.person.role.revoke": { privileged: false, roles: ["tech_admin"] },
  "emulation.session.start": { privileged: false, roles: ["tech_admin"] },
  "emulation.session.end": { privileged: false, roles: ["tech_admin"] },
  "emulation.simulate": { privileged: false, roles: ["tech_admin"] },
};

export function isActionKey(value: string): value is ActionKey {
  return Object.hasOwn(ACTIONS, value);
}
