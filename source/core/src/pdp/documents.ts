import { ALLOW, deny, type Actor, type Decision, type ResourceRef } from "./types.ts";

/** DOC-03: доступ к источнику и аудитория документа проверяются независимо. */
export function documentDecision(actor: Actor, action: string, resource: ResourceRef): Decision {
  if (action === "document.obligations") return actor.person.status === "active" && actor.assignments.some(a => a.role !== "tech_admin") ? ALLOW : deny("Очередь документов доступна действующим сотрудникам");
  const r = resource.documentAccess;
  const no = () => deny("Документ недоступен");
  if (!r || r.isTest !== actor.person.isTest || actor.person.status !== "active") return no();
  const scoped = actor.assignments.filter(a => a.role !== "tech_admin" && (
    actor.globalStaff || a.role === "chairman" ||
    (r.buildingIds.length > 0 && r.buildingIds.every(id => a.scopeBuildingIds?.includes(id)))
  ));
  const manager = scoped.some(a => ["chairman", "administrator", "deputy"].includes(a.role));
  const staff = actor.assignments.some(a => a.role !== "tech_admin");
  const reviewer = r.reviewerId === actor.person.id && scoped.some(a =>
    ["chairman", "administrator", "deputy", "doc_reviewer"].includes(a.role));
  const source = r.reviewSource;
  const delegatedReview = reviewer && source && source.isTest === actor.person.isTest && !source.draft &&
    source.complaintSubjectId !== actor.person.id && (!source.chairmanOnly || scoped.some(a => a.role === "chairman"));
  if (!r.sourceAllowed && !delegatedReview) return no();
  const preparer = r.preparedById === actor.person.id && staff && r.assignedTask;
  const finance = scoped.some(a => ["chairman", "administrator", "deputy", "finance"].includes(a.role));
  if (r.financial && !finance) return action === "document.read" && r.published &&
    ((r.audience === "owner" && r.owner) || (r.audience === "resident" && r.member)) ? ALLOW : no();
  if (r.audience === "finance" && !finance) return no();
  if (r.audience === "service") return no(); // ROL-06: отдельного разрешения поддержки пока нет.
  if (action === "document.review") return reviewer && r.preparedById !== actor.person.id &&
    !r.resultAuthorIds.includes(actor.person.id) ? ALLOW : no();
  if (action === "document.manage") return manager && r.sourceManageable ? ALLOW : no();
  if (action === "document.prepare") return (manager && r.sourceManageable) || preparer ? ALLOW : no();
  if (action !== "document.read") return no();
  if (manager || reviewer || preparer || (r.assignedTask && staff) || ((r.financial || r.audience === "finance") && finance)) return ALLOW;
  if (!r.published) return no();
  if (r.audience === "resident" && r.member) return ALLOW;
  if (r.audience === "owner" && r.owner) return ALLOW;
  return no();
}
