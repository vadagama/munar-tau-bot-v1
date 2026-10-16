// Реестр действий PDP — единый источник требований (LLD-01 §3.1, §6).
// Новая операция добавляется сюда; privileged-действия (AUTH-03) доступны
// только через кабинет и запрещены в эмуляции.

import type { SpecialRights, StaffRole } from "./types.ts";

export type ActionKey =
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
  "emulation.session.start": { privileged: false, roles: ["tech_admin"] },
  "emulation.session.end": { privileged: false, roles: ["tech_admin"] },
  "emulation.simulate": { privileged: false, roles: ["tech_admin"] },
};

export function isActionKey(value: string): value is ActionKey {
  return Object.hasOwn(ACTIONS, value);
}
