import type { Actor, StaffRole } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import {
  canManageRole,
  canManageStaff,
  effectiveRoles,
} from "../../pdp/roles.ts";
import { STAFF_ROLES } from "../../pdp/types.ts";
import { isAssignmentEffective } from "../../pdp/actor.ts";
import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { recordAudit } from "../registry/service.ts";
import type { AdminRepo, AssignmentListRecord } from "./port.ts";
import { content, idempotent } from "../requests/service.ts";
import { buildActorForProfile } from "./actor-service.ts";
import { notifyRoleChange } from "./staff-notice.ts";
import { authorizeRoleChange, staffRolesInput } from "./staff-policy.ts";
export interface StaffDeps extends RegistryDeps {
  admin: AdminRepo;
}
function requireStaff(actor: Actor, edit = false) {
  if (actor.person.status !== "active" || !can(actor, edit ? "staff.edit" : "staff.read").allow) {
    throw new ApiError("FORBIDDEN");
  }
}
function currentRoles(rows: AssignmentListRecord[], now: Date): StaffRole[] {
  return [
    ...new Set(
      rows.filter((row) => isAssignmentEffective(row, now)).map((row) =>
        row.role
      ),
    ),
  ].sort();
}
async function version(rows: AssignmentListRecord[]): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(
        rows.map(
          (r) => [
            r.id,
            r.role,
            r.status,
            r.validFrom,
            r.validUntil,
            r.financialRights,
            r.registryExportRights,
            r.regulationsRights,
            r.scopeBuildingIds,
          ],
        ).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
    ),
  );
  return Array.from(
    new Uint8Array(bytes),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function assignments(deps: StaffDeps, exec: DbExecutor, id: string) {
  const rows = await deps.admin.listAssignments(exec, {
    personId: id,
    activeOnly: false,
    limit: 5001,
  });
  if (rows.length > 5000) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "История назначений слишком велика для этой операции",
    );
  }
  return rows;
}
export async function staffDetail(deps: StaffDeps, actor: Actor, id: string) {
  requireStaff(actor);
  const person = await deps.admin.getPerson(deps.db, id);
  if (!person || person.isTest !== actor.person.isTest) {
    throw new ApiError("NOT_FOUND");
  }
  const rows = await assignments(deps, deps.db, id),
    roles = currentRoles(rows, new Date());
  const [{ tasks = 0, requests = 0, schedules = 0 } = {}] = await deps.db.query<
    { tasks: number; requests: number; schedules: number }
  >(
    `select (select count(*)::int from task where assignee_person_id=$1 and state not in ('accepted_admin','canceled')) tasks,
      (select count(*)::int from request where assigned_admin_person_id=$1 and state not in ('closed','canceled','rejected','draft')) requests,
      (select count(*)::int from job_schedule where configured_by=$1 and enabled) schedules`,
    [id],
  );
  const history = await deps.db.query(
    `select a.id,a.at,a.action,a.reason,a.before,a.after,p.full_name as actor_name
    from audit_log a left join person p on p.id=a.actor_person_id
    where a.entity_type='person' and a.entity_id=$1 and a.action='staff.roles.changed' order by a.id desc limit 100`,
    [id],
  );
  return {
    id: person.id,
    full_name: person.fullName,
    phone_e164: person.phoneE164,
    roles,
    effective_roles: effectiveRoles(roles),
    can_remove: rows.some((r) => r.status === "active"),
    version: await version(rows),
    can_edit: await deps.admin.hasActiveProfile(deps.db, id) &&
      person.status === "active" && canManageStaff(
        actor,
        id,
        rows.filter((r) => r.status === "active").map((r) => r.role),
      ),
    workload: { tasks, requests, schedules },
    history,
    assignments: rows.map((r) => ({
      id: r.id,
      role: r.role,
      status: r.status,
      created_at: r.createdAt,
      assigned_by: r.assignedBy,
      revoked_by: r.revokedBy,
    })),
  };
}
export function staffAvailableRoles(actor: Actor): StaffRole[] {
  return STAFF_ROLES.filter((role) =>
    canManageRole(
      actor.assignedRoles ?? actor.assignments.map((a) => a.role),
      role,
    )
  );
}
export async function staffList(deps: StaffDeps, actor: Actor) {
  requireStaff(actor);
  const items = await deps.db.query(
    `select p.id,p.full_name,p.phone_e164,
    coalesce(array_agg(distinct a.role::text) filter(where a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())),array[]::text[]) roles,
    coalesce(bool_or(a.status='active' and a.valid_from>now() and (a.valid_until is null or a.valid_until>now())),false) scheduled,
    (select count(*)::int from task t where t.assignee_person_id=p.id and t.state not in ('accepted_admin','canceled')) open_tasks
    from person p join staff_assignment a on a.person_id=p.id where p.is_test=$1 and p.status='active'
    group by p.id order by p.full_name,p.id limit 1000`,
    [actor.person.isTest],
  );
  return {
    items,
    available_roles: staffAvailableRoles(actor),
    can_edit: can(actor, "staff.edit").allow,
  };
}
export async function staffCandidates(
  deps: StaffDeps,
  actor: Actor,
  query: string,
) {
  requireStaff(actor, true);
  return deps.db.query(
    `select p.id,p.full_name,p.phone_e164 from person p
    where p.status='active' and p.is_test=$1 and (p.full_name ilike $2 or p.phone_e164 ilike $2)
    and p.id<>$3 and exists(select 1 from profile f where f.person_id=p.id and f.archived_at is null)
    and not exists(select 1 from staff_assignment a where a.person_id=p.id and a.status='active'
      and (a.valid_until is null or a.valid_until>now()))
    order by p.full_name,p.id limit 50`,
    [actor.person.isTest, `%${query.slice(0, 120)}%`, actor.person.id],
  );
}
export async function saveStaffRoles(
  deps: StaffDeps,
  actor: Actor,
  id: string,
  input: Record<string, unknown>,
  key: unknown,
) {
  requireStaff(actor, true);
  const next = staffRolesInput(input.roles),
    reason = content(input.reason, "причину изменения ролей");
  if (typeof input.expected_version !== "string") {
    throw new ApiError("VALIDATION_FAILED", "Нужна версия перечня ролей");
  }
  return deps.db.transaction(async (exec) => {
    for (const personId of [...new Set([id, actor.person.id])].sort()) {
      await deps.admin.lockPerson(exec, personId);
    }
    const profile = await deps.admin.getProfile(exec, actor.profile.id);
    if (!profile || profile.archivedAt) throw new ApiError("FORBIDDEN");
    const fresh = await buildActorForProfile(
      deps.admin,
      exec,
      profile,
      new Date(),
    );
    requireStaff(fresh, true);
    const person = await deps.admin.getPerson(exec, id);
    if (
      !person || person.status !== "active" ||
      person.isTest !== fresh.person.isTest ||
      !await deps.admin.hasActiveProfile(exec, id)
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Выберите зарегистрированного пользователя с действующим профилем",
      );
    }
    const rows = await assignments(deps, exec, id),
      before = currentRoles(rows, new Date());
    authorizeRoleChange(
      fresh,
      id,
      rows.filter((r) => r.status === "active").map((r) => r.role),
      next,
    );
    return idempotent(
      exec,
      fresh,
      `staff:${id}:roles`,
      key,
      input,
      async () => {
        if (input.expected_version !== await version(rows)) {
          throw new ApiError("CONCURRENT_MODIFICATION");
        }
        const added = next.filter((r) => !before.includes(r)),
          removed = before.filter((r) => !next.includes(r));
        if (
          !added.length && !removed.length &&
          !rows.some((r) =>
            r.status === "active" && !isAssignmentEffective(r, new Date())
          )
        ) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Перечень ролей не изменился",
          );
        }
        const retained = new Set<StaffRole>();
        for (const row of rows.filter((r) => r.status === "active")) {
          if (
            next.includes(row.role) && isAssignmentEffective(row, new Date()) &&
            !retained.has(row.role)
          ) retained.add(row.role);
          else await deps.admin.revokeAssignment(exec, row.id, fresh.person.id);
        }
        for (const role of next.filter((r) => !retained.has(r))) {
          await deps.admin.insertAssignment(exec, {
            personId: id,
            role,
            financialRights: false,
            registryExportRights: false,
            regulationsRights: false,
            validFrom: null,
            validUntil: null,
            scopeBuildingIds: [],
            assignedByPersonId: fresh.person.id,
          });
        }
        if (removed.length) {
          await deps.admin.revokeSessionsForPerson(
            exec,
            id,
            reason,
            new Date(),
          );
        }
        await recordAudit(
          deps,
          exec,
          fresh,
          "staff.roles.changed",
          "person",
          id,
          [],
          { roles: before },
          { roles: next },
          reason,
        );
        await notifyRoleChange(
          exec,
          fresh,
          id,
          before,
          next,
          reason,
          `staff:${id}:${await version(rows)}:${String(key)}`,
          person.isTest,
        );
        return {
          id,
          roles: next,
          version: await version(await assignments(deps, exec, id)),
        };
      },
    );
  });
}
