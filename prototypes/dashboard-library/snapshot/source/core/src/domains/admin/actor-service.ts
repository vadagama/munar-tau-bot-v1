// Сборка Actor для аутентификации и конвейера (LLD-01 §3.1, AUTH-01):
// вход не выдаёт роль — профиль ищется строго по supabase_user_id, полномочия
// собирает buildActor из действующих назначений (ROL-03/04 проверяются там).

import { withRoleHierarchy } from "../../pdp/roles.ts";
import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import { buildActor } from "../../pdp/actor.ts";
import type { Actor } from "../../pdp/types.ts";
import type { AdminRepo, ProfileRecord } from "./port.ts";

/**
 * Профиль по идентификатору пользователя Supabase (claim sub).
 * Неизвестный sub — NO_PROFILE: вход не создаёт профиль и не выдаёт роль.
 */
export async function findProfileForAuth(
  repo: AdminRepo,
  exec: DbExecutor,
  supabaseUserId: string,
): Promise<ProfileRecord> {
  const profile = await repo.findProfileBySupabaseUserId(exec, supabaseUserId)
    ?? await repo.linkProfileFromVerifiedIdentity?.(exec,supabaseUserId);
  if (!profile) {
    throw new ApiError("NO_PROFILE");
  }
  return profile;
}

/** Actor по профилю: персона и действующие назначения на момент now. */
export async function buildActorForProfile(
  repo: AdminRepo,
  exec: DbExecutor,
  profile: ProfileRecord,
  now: Date,
): Promise<Actor> {
  const person = await repo.getPerson(exec, profile.personId);
  if (!person) {
    throw new ApiError("NO_PROFILE", "Персона профиля не найдена");
  }
  const assignmentRows = await repo.listActiveAssignments(exec, profile.personId);
  return withRoleHierarchy(buildActor(
    { id: person.id, fullName: person.fullName, status: person.status, isTest: person.isTest },
    { id: profile.id, personId: profile.personId, language: profile.language, isTest: profile.isTest },
    assignmentRows,
    now,
  ), await repo.listBuildingIds?.(exec));
}
