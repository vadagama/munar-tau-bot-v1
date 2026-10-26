// Хук идентичности: /v1/meta/me через authProvider.getIdentity (Refine),
// с флагами ролей для меню и страниц.

import { useCallback } from "react";
import { STAFF_ROLES } from "../../../core/src/pdp/types";
import { useGetIdentity } from "@refinedev/core";

import type { MeResponse } from "./types";

export interface CabinetIdentity {
  id: string;
  fullName: string;
  me: MeResponse;
}

export function useCabinetIdentity(): {
  identity: CabinetIdentity | undefined;
  isLoading: boolean;
  roles: string[];
  isError: boolean;
  refreshIdentity: () => Promise<unknown>;
} {
  const { data, isLoading, isError, refetch } = useGetIdentity<CabinetIdentity>();
  const refreshIdentity = useCallback(() => refetch({ throwOnError: true }), [refetch]);
  const roles = data?.me.effective_roles ?? data?.me.assignments.map((assignment) => assignment.role) ?? [];
  return { identity: data, isLoading, roles: [...new Set(roles)], isError, refreshIdentity };
}

/** Доступные разделы по ролям (сервер всё равно проверяет PDP). */
export function canSeeAudit(roles: string[]): boolean {
  return roles.some((role) => ["chairman", "administrator", "tech_admin"].includes(role));
}

export function canUseEmulation(roles: string[]): boolean {
  return roles.includes("tech_admin");
}

export function canSeeTemplates(roles:string[]):boolean {return roles.some(role=>["chairman","administrator","tech_admin"].includes(role));}

/** Задания доступны всем сотрудникам; сервер ограничивает конкретные карточки. */
export function canSeeTasks(roles: string[]): boolean {
  return roles.some(role => STAFF_ROLES.some(staffRole => staffRole === role));
}
