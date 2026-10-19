// Оценка доступа can() — единственный способ проверки полномочий (LLD-01 §3.1).
// Deny-by-default. Оценка детерминированная: часы БД и отзыв полномочий
// проверяются при сборке Actor, здесь работают только собранные данные.

import { ACTIONS, type ActionKey, type ActionSpec } from "./actions.ts";
import { ALLOW, deny, type Actor, type Decision, type ResourceRef, type StaffRole } from "./types.ts";

/** can(actor, action, resource) — контракт LLD-01 §3.1. */
export function can(actor: Actor, action: ActionKey, resource: ResourceRef = {}): Decision {
  const spec: ActionSpec | undefined = ACTIONS[action];
  if (!spec) return deny(`Неизвестное действие: ${action}`);

  // Эмуляция (HLD 10.8): права оцениваются по эмулируемой роли, но привилегированные
  // действия и управление (права, сеансы, сама эмуляция) недоступны.
  if (actor.emulation !== null) {
    if (spec.privileged) {
      return deny("Привилегированные действия в эмуляции недоступны");
    }
    if (action.startsWith("admin.") || action.startsWith("emulation.")) {
      return deny("Управляющие действия в эмуляции недоступны");
    }
  }

  if (action.startsWith("request.") && action !== "request.use" && action !== "request.category.edit") {
    const r = resource.requestAccess;
    if (!r || r.isTest !== actor.person.isTest || actor.person.status !== "active") return deny("Обращение недоступно");
    const own = r.authorId === actor.person.id;
    // Обращение без дома (REG-01) попадает в общую очередь: администратору и
    // заместителю оно доступно без домовой области; chairmanOnly сохраняется.
    const staff = r.state !== "draft" && r.complaintSubjectId !== actor.person.id && actor.assignments.some(a =>
      a.role === "chairman" || (!r.chairmanOnly && ["administrator", "deputy"].includes(a.role) && (r.buildingId === null || (a.scopeBuildingIds ?? []).includes(r.buildingId))));
    const resident = own || (r.state !== "draft" && r.participant);
    if (action === "request.author") return own && r.activeAuthor ? ALLOW : deny("Нужна действующая связь автора");
    if (action === "request.manage" || action === "request.internal") return staff ? ALLOW : deny("Нет полномочий на обращение");
    if (action === "request.comment") return staff || (resident && r.activeAuthor && r.state !== "draft") ? ALLOW : deny("Нет действующего доступа для переписки");
    return resident || staff ? ALLOW : deny("Обращение недоступно");
  }

  if ((action.startsWith("incident.") && action !== "incident.use") || action.startsWith("publication.")) {
    const r = action.startsWith("incident.") ? resource.incidentAccess : resource.publicationAccess;
    if (!r || r.isTest !== actor.person.isTest || actor.person.status !== "active" || !r.buildingIds.length) return deny("Объект недоступен");
    const inScope = (a: Actor["assignments"][number]) => r.buildingIds.every(id => a.scopeBuildingIds?.includes(id));
    const chairman = actor.assignments.some(a => a.role === "chairman");
    const manager = chairman || actor.assignments.some(a => ["administrator", "deputy"].includes(a.role) && inScope(a));
    const duty = resource.incidentAccess?.responsibleId === actor.person.id && actor.assignments.some(a => a.role === "duty" && inScope(a));
    if (action === "publication.approve") return chairman ? ALLOW : deny("Требуется председатель");
    if (action === "incident.link" || action === "publication.manage") return manager ? ALLOW : deny("Требуется администратор области");
    if (action === "incident.manage") return manager || duty ? ALLOW : deny("Требуется администратор или назначенный дежурный");
    return manager || (action === "incident.read" && duty) || (r.published && r.member) ? ALLOW : deny("Объект недоступен");
  }

  // Собственный ресурс: любой аутентифицированный завершает свой сеанс (AUTH-06).
  if (action.startsWith("task.") && action !== "task.use") {
    const r = resource.taskAccess;
    if (!r || r.isTest !== actor.person.isTest || actor.person.status !== "active") return deny("Задание недоступно");
    const inScope = (a: Actor["assignments"][number]) => r.buildingIds.length > 0 && r.buildingIds.every(id => a.scopeBuildingIds?.includes(id));
    const manager = actor.assignments.some(a => a.role === "chairman" || (["administrator", "deputy"].includes(a.role) && inScope(a)));
    const executor = r.assigneeId === actor.person.id && actor.assignments.length > 0;
    if (action === "task.manage") return manager ? ALLOW : deny("Нет полномочий управления заданием");
    if (action === "task.execute") return executor ? ALLOW : deny("Нужно действующее назначение исполнителя");
    return manager || executor ? ALLOW : deny("Задание недоступно");
  }

  if (spec.allowOwn && resource.profileId !== undefined && resource.profileId === actor.profile.id) {
    return ALLOW;
  }

  if (!hasRequiredAssignment(actor, spec)) {
    return deny(spec.roles
      ? `Требуется роль: ${spec.roles.join(", ")}`
      : "Действие не разрешено этой учётной записи");
  }

  if (action === "admin.assignment.create" || action === "admin.assignment.update") {
    return checkAssignmentMutation(actor, resource);
  }

  if (action === "registry.export" && !actor.assignments.some(a =>
    a.role === "chairman" || (a.role === "administrator" && a.registryExportRights))) {
    return deny("Для экспорта требуется право IMP-05");
  }
  return ALLOW;
}

/** Наличие роли с требуемыми спецправами среди действующих назначений. */
function hasRequiredAssignment(actor: Actor, spec: ActionSpec): boolean {
  if (!spec.roles) return true;
  return actor.assignments.some((assignment) =>
    spec.roles!.includes(assignment.role) && hasRequiredRights(assignment, spec.requiresRights)
  );
}

function hasRequiredRights(
  assignment: { financialRights: boolean; registryExportRights: boolean; regulationsRights: boolean },
  required?: Partial<{ financialRights: boolean; registryExportRights: boolean; regulationsRights: boolean }>,
): boolean {
  if (!required) return true;
  if (required.financialRights && !assignment.financialRights) return false;
  if (required.registryExportRights && !assignment.registryExportRights) return false;
  if (required.regulationsRights && !assignment.regulationsRights) return false;
  return true;
}

/**
 * Мутации назначений (ROL-02, ROL-02a, ROL-02b, ROL-02c):
 * председатель действует по всему ОСИ без назначения; администратор —
 * исполнители, дежурные, проверяющие документов и временный заместитель
 * в пределах своей области; спецправа выдаёт только председатель.
 */
function checkAssignmentMutation(actor: Actor, resource: ResourceRef): Decision {
  if (actor.assignments.some((a) => a.role === "chairman")) {
    return checkChairmanTarget(resource);
  }

  const admin = actor.assignments.find((a) => a.role === "administrator");
  if (!admin) {
    return deny("Назначения выполняет председатель или администратор");
  }

  if (resource.targetSpecialRights) {
    return deny("Спецправа выдаёт только председатель (ROL-02b)");
  }

  const adminTargets: readonly StaffRole[] = ["executor", "duty", "doc_reviewer", "deputy"];
  if (!resource.targetRole || !adminTargets.includes(resource.targetRole)) {
    return deny("Администратор назначает только исполнителя, дежурного, проверяющего документов или заместителя");
  }

  if (resource.targetRole === "deputy" && !resource.targetValidUntil) {
    return deny("Заместитель назначается временно — укажите срок полномочий (ROL-03)");
  }

  // Область цели — непустая и в пределах области администратора.
  const scope = admin.scopeBuildingIds ?? [];
  const target = resource.buildingIds ?? [];
  if (target.length === 0) {
    return deny("Укажите область домов назначения");
  }
  if (!target.every((buildingId) => scope.includes(buildingId))) {
    return deny("Область назначения выходит за пределы области администратора");
  }
  return ALLOW;
}

/** Председатель назначает любые роли; исполнителям и прочим — явная область. */
function checkChairmanTarget(resource: ResourceRef): Decision {
  const wholeOsiRoles: readonly StaffRole[] = ["chairman", "tech_admin"];
  const targetRole = resource.targetRole;
  if (targetRole && !wholeOsiRoles.includes(targetRole)) {
    const target = resource.buildingIds ?? [];
    if (target.length === 0) {
      return deny("Для роли, кроме председателя и техадмина, укажите область домов");
    }
  }
  return ALLOW;
}
