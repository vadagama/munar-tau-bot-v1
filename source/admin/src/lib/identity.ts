// Хук идентичности: /v1/meta/me через authProvider.getIdentity (Refine),
// с флагами ролей для меню и страниц.

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
} {
  const { data, isLoading, isError } = useGetIdentity<CabinetIdentity>();
  const roles = data?.me.assignments.map((assignment) => assignment.role) ?? [];
  return { identity: data, isLoading, roles: [...new Set(roles)], isError };
}

/** Доступные разделы по ролям (сервер всё равно проверяет PDP). */
export function canSeeAudit(roles: string[]): boolean {
  return roles.some((role) => ["chairman", "administrator", "tech_admin"].includes(role));
}

export function canUseEmulation(roles: string[]): boolean {
  return roles.includes("tech_admin");
}

export function canSeeTemplates(roles:string[]):boolean {return roles.some(role=>["chairman","administrator","tech_admin"].includes(role));}
