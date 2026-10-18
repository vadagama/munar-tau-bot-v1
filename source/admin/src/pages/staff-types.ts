import { ROLE_LABELS } from "../../../core/src/pdp/roles";
import type { StaffRole } from "../../../core/src/pdp/types";
export interface StaffRow {
  id: string;
  full_name: string;
  phone_e164: string;
  roles: StaffRole[];
  scheduled?: boolean;
  open_tasks?: number;
}
export interface StaffCard extends StaffRow {
  version: string;
  can_edit: boolean;
  can_remove?: boolean;
  effective_roles: StaffRole[];
  workload: { tasks: number; requests: number; schedules: number };
  history: {
    id: string;
    at: string;
    actor_name: string;
    reason: string;
    before: { roles: StaffRole[] };
    after: { roles: StaffRole[] };
  }[];
  assignments: {
    id: string;
    role: StaffRole;
    status: string;
    created_at: string;
  }[];
}
export interface StaffList {
  items: StaffRow[];
  available_roles: StaffRole[];
  can_edit: boolean;
}
export const staffRoleLabels = (roles: StaffRole[]) =>
  roles.map((r) => ROLE_LABELS[r]).join(", ") || "Нет служебных ролей";
