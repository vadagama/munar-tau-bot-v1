import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { listRegistrations } from "../registrations/service.ts";
import { dashboardTasks, dashboardIncidents } from "./queues.ts";
import { dashboardRequests } from "./requests.ts";
export { dashboardRequests, dashboardAnalytics } from "./requests.ts";

export interface DashboardItem {
  id: string; label: string; state: string; href: string;
  building?: { label: string; href?: string };
  premises?: { label: string; href?: string };
  overdue?: boolean;
}
export interface DashboardWidget { id: string; title: string; total: number; items: DashboardItem[]; href: string }
const manager = (a: Actor) => a.person.status === "active" && a.assignments.some(x => ["chairman", "administrator", "deputy"].includes(x.role));
const requestPath = (id: unknown) => `/requests?request=${encodeURIComponent(String(id))}&entity_page=1`;
function location(row: Row, registry: boolean): Pick<DashboardItem, "building" | "premises"> {
  const kind: Record<string, string> = { apartment: "Квартира", parking: "Паркинг", storage: "Кладовка", commercial: "Коммерческое помещение" };
  return {
    building: row.building_id ? { label: String(row.building_name ?? row.building_code ?? "Дом"),
      href: registry ? `/registry/buildings?entity=${row.building_id}&entity_page=1` : undefined } : undefined,
    premises: row.premises_id ? { label: `${kind[String(row.premises_kind ?? row.kind)] ?? "Помещение"} ${row.premises_number ?? row.number ?? ""}`,
      href: registry ? `/registry/premises?entity=${row.premises_id}&entity_page=1` : undefined } : undefined,
  };
}
export async function getDashboard(deps: RegistryDeps, actor: Actor) {
  const widgets: DashboardWidget[] = [];
  const registry = can(actor, "registry.read").allow;
  const add = (id: string, title: string, rows: Row[], href: string, map: (r: Row) => DashboardItem) =>
    widgets.push({ id, title, total: rows.length, items: rows.slice(0, 20).map(map), href });
  if (manager(actor)) {
    const [newPage, actionPage] = await Promise.all([dashboardRequests(deps, actor, { queue: "new", limit: 20 }), dashboardRequests(deps, actor, { queue: "attention", limit: 20 })]);
    const map = (r: Row): DashboardItem => ({ id: String(r.id), label: `№${r.number} · ${r.description}`, state: String(r.state), href: requestPath(r.id), overdue: !!r.current_overdue, ...location(r, registry) });
    widgets.push({ id: "new", title: "Новые обращения", total: newPage.total, items: newPage.items.map(map), href: "/requests?dashboard_queue=new" });
    widgets.push({ id: "action", title: "Требуют вашего действия", total: actionPage.total, items: actionPage.items.map(map), href: "/requests?dashboard_queue=attention" });
  }
  if (can(actor, "registration.review").allow) {
    const registrations = (await listRegistrations(deps, actor)).filter(r => ["pending_review", "need_clarification", "disputed"].includes(String(r.state)));
    const map = (r: Row): DashboardItem => ({ id: String(r.id), label: String((r.draft as Row)?.full_name ?? "Анкета"), state: String(r.state), href: `/registrations?registration=${r.id}`, ...location(r, registry) });
    add("registrations", "Регистрации", registrations.filter(r => !r.premises_id), "/registrations?kind=primary", map);
    add("bindings", "Привязки помещений", registrations.filter(r => r.premises_id), "/registrations?kind=binding", map);
  }
  if (actor.assignments.length) {
    const tasks = await dashboardTasks(deps, actor);
    add("tasks", "Задания: принятие и проверка", tasks.filter(r => ["created", "awaiting_acceptance", "on_review"].includes(r.state)), "/tasks", r => ({
      id: String(r.id), label: `№${r.number} · ${r.title ?? "Задание"}`, state: String(r.state), href: `/tasks?task=${r.id}&entity_page=1`,
    }));
  }
  if (manager(actor) || actor.assignments.some(a => a.role === "duty")) {
    const incidents = await dashboardIncidents(deps, actor);
    add("incidents", "Аварии", incidents, "/incidents", r => ({ id: String(r.id), label: `№${r.number} · ${r.title}`, state: String(r.state), href: `/incidents?incident=${r.id}&entity_page=1` }));
  }
  return { widgets, analytics: manager(actor), assistant: { state: "disabled" as const }, generated_at: new Date().toISOString() };
}
