import type { Actor, StaffRole } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { canManageStaff } from "../../pdp/roles.ts";
import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import { idempotent } from "../requests/service.ts";
import { registryScope } from "../registry/access.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { jsonValue, type Row, text } from "../registry/validation.ts";
import { reviseRegistration } from "./service.ts";

/** Повторная авторизация внутри транзакции: отзыв роли не обходит открытый кабинет. */
async function authorize(
  exec: DbExecutor,
  actor: Actor,
  row: Row,
): Promise<Actor> {
  if (
    actor.person.status !== "active" || row.is_test !== actor.person.isTest ||
    row.superseded_by
  ) {
    throw new ApiError("NOT_FOUND");
  }
  const [person] = await exec.query<Row>(
    "select id,is_test,status from person where id=$1 for update",
    [actor.person.id],
  );
  if (
    !person || person.status !== "active" ||
    person.is_test !== actor.person.isTest
  ) {
    throw new ApiError("FORBIDDEN");
  }
  const assignments = await exec.query<Row>(
    "select * from staff_assignment where person_id=$1 and status='active' for update",
    [actor.person.id],
  );
  const now = Date.now();
  const roles = assignments.filter((a) =>
    (!a.valid_from || new Date(String(a.valid_from)).getTime() <= now) &&
    (!a.valid_until || new Date(String(a.valid_until)).getTime() > now)
  ).map((a) => String(a.role) as StaffRole);
  const fresh: Actor = {
    ...actor,
    assignedRoles: roles,
    assignments: actor.assignments.filter((a) => roles.includes(a.role)),
  };
  const own = row.person_id === actor.person.id;
  if (!can(fresh, own ? "registration.self" : "registration.manage").allow) {
    throw new ApiError("FORBIDDEN");
  }
  if (!own && row.premises_id && !roles.includes("tech_admin")) {
    const scope = registryScope(fresh);
    const [premises] = await exec.query<Row>(
      "select building_id,is_test from premises where id=$1",
      [row.premises_id],
    );
    if (
      !premises || premises.is_test !== actor.person.isTest ||
      (scope !== null && !scope.includes(String(premises.building_id)))
    ) {
      throw new ApiError("NOT_FOUND");
    }
  }
  return fresh;
}

/** Причина/версия и идемпотентность общие для кабинета и подтверждения в боте. */
export async function manageRegistration(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
): Promise<Row> {
  const operation = input.operation;
  if (!["edit", "delete"].includes(String(operation))) {
    throw new ApiError("VALIDATION_FAILED");
  }
  const reason = text(input, "reason");
  if (
    !Number.isInteger(input.expected_version) ||
    Number(input.expected_version) < 1
  ) {
    throw new ApiError("VALIDATION_FAILED", "Нужна версия анкеты");
  }
  return deps.db.transaction(async (exec) => {
    // Авторизацию проверяем и для повторного Idempotency-Key.
    const load = async () => {
      const [row] = await exec.query<Row>(
        "select * from registration where id=$1 for update",
        [id],
      );
      if (!row) throw new ApiError("NOT_FOUND");
      return { row, fresh: await authorize(exec, actor, row) };
    };
    const { row, fresh } = await load();
    return idempotent(
      exec,
      fresh,
      `registration:${id}:${operation}`,
      key,
      input,
      async () => {
        if (row.version !== input.expected_version) {
          throw new ApiError("CONCURRENT_MODIFICATION");
        }
        if (row.state === "withdrawn") throw new ApiError("INVALID_TRANSITION");
        if (operation === "edit") {
          return reviseRegistration(deps, exec, fresh, row, {
            ...jsonValue<Row>(row.draft),
            ...input,
          });
        }
        if (row.person_id) {
          const [target] = await exec.query<Row>(
            "select id,is_test,status from person where id=$1 for update",
            [row.person_id],
          );
          if (
            !target || target.is_test !== actor.person.isTest
          ) {
            throw new ApiError("NOT_FOUND");
          }
          const roles = await exec.query<Row>(
            "select * from staff_assignment where person_id=$1 and status='active' for update",
            [row.person_id],
          );
          // Включая будущие назначения: удаление не оставляет отложенных полномочий.
          const targetRoles = roles.map((a) => String(a.role) as StaffRole);
          if (
            targetRoles.some((role) =>
              ["chairman", "tech_admin"].includes(role)
            )
          ) {
            throw new ApiError(
              "FORBIDDEN",
              "Сначала передайте защищённые полномочия отдельной процедурой",
            );
          }
          const own = row.person_id === actor.person.id;
          if (
            !own && targetRoles.length &&
            !fresh.assignedRoles?.includes("tech_admin") &&
            !canManageStaff(fresh, String(row.person_id), targetRoles)
          ) {
            throw new ApiError(
              "FORBIDDEN",
              "Можно прекращать только младшие служебные полномочия",
            );
          }
          const [outside] = await exec.query<Row>(
            "select id from profile where person_id=$1 and archived_at is null and is_test<>$2",
            [row.person_id, actor.person.isTest],
          );
          if (outside) throw new ApiError("NOT_FOUND");
          await exec.query(
            "update access_session set revoked_at=now(),revoked_reason=$2 where profile_id in (select id from profile where person_id=$1) and revoked_at is null",
            [row.person_id, reason],
          );
          await exec.query(
            "update emulation_session set state='ended',ended_at=now() where state='active' and (emulated_profile_id in (select id from profile where person_id=$1) or tech_admin_profile_id in (select id from profile where person_id=$1))",
            [row.person_id],
          );
          await exec.query(
            "update invite set status='revoked' where created_by=$1 and status='active'",
            [row.person_id],
          );
          await exec.query(
            "update connection set status='revoked',revoked_reason=$2,end_date=greatest(current_date,start_date) where person_id=$1 and status in ('pending','active')",
            [row.person_id, reason],
          );
          await exec.query(
            "update staff_assignment set status='revoked',revoked_by=$2 where person_id=$1 and status='active'",
            [row.person_id, actor.person.id],
          );
          await exec.query(
            "update person set status='archived',updated_at=now() where id=$1",
            [row.person_id],
          );
          await exec.query(
            "update profile set archived_at=now() where person_id=$1 and archived_at is null",
            [row.person_id],
          );
        }
        await exec.query(
          "update notification set state='failed',last_error='REGISTRATION_DELETED' where state='queued' and (recipient_person_id=$1 or telegram_user_id=$2)",
          [row.person_id, row.telegram_user_id],
        );
        await exec.query(
          "update timer set state='canceled' where state='pending' and entity_id in (select id from registration where id=$1 or person_id=$2 or telegram_user_id=$3)",
          [id, row.person_id, row.telegram_user_id],
        );
        await exec.query(
          "update registration set state='withdrawn',confirmed_draft=null,decided_reason=$4 where id=$1 or person_id=$2 or telegram_user_id=$3",
          [id, row.person_id, row.telegram_user_id, reason],
        );
        await exec.query(
          "delete from bot_dialog where telegram_user_id=$1 or profile_id in (select id from profile where person_id=$2)",
          [row.telegram_user_id, row.person_id],
        );
        await exec.query(
          "delete from bot_dialog_channel where telegram_user_id=$1 or profile_id in (select id from profile where person_id=$2)",
          [row.telegram_user_id, row.person_id],
        );
        await recordAudit(
          deps,
          exec,
          fresh,
          "registration.delete",
          "registration",
          id,
          [],
          { state: row.state },
          { state: "withdrawn", access_closed: true },
          reason,
        );
        return { id, state: "withdrawn", access_closed: true };
      },
      async () => {
        await load();
      },
    );
  });
}

/** До появления person/profile право заявителя подтверждено Telegram webhook. */
export async function withdrawUnconfirmedRegistration(
  deps: RegistryDeps,
  telegramId: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  await deps.db.transaction(async (exec) => {
    const [row] = await exec.query<Row>(
      "select * from registration where id=$1 and telegram_user_id=$2 for update",
      [id, telegramId],
    );
    if (!row || (row.person_id && !row.reactivating) || row.is_test || row.superseded_by) {
      throw new ApiError("NOT_FOUND");
    }
    if (row.person_id) {
      const [person] = await exec.query<Row>("select id,is_test,status from person where id=$1 for update", [row.person_id]);
      if (!person || person.status !== "archived" || person.is_test) throw new ApiError("NOT_FOUND");
    }
    if (row.state === "withdrawn") return;
    if (row.version !== expectedVersion) {
      throw new ApiError("CONCURRENT_MODIFICATION");
    }
    await exec.query(
      "update timer set state='canceled' where entity_id=$1 and state='pending'",
      [id],
    );
    await exec.query(
      "update registration set state='withdrawn',confirmed_draft=null where id=$1",
      [id],
    );
    await exec.query(
      "update notification set state='failed',last_error='REGISTRATION_DELETED' where telegram_user_id=$1 and state='queued'",
      [telegramId],
    );
    await exec.query("delete from bot_dialog_channel where telegram_user_id=$1", [telegramId]);
    await exec.query("delete from bot_dialog where telegram_user_id=$1", [
      telegramId,
    ]);
    await deps.audit.append(exec, {
      actorPersonId: null,
      actorProfileId: null,
      emulationSessionId: null,
      emulatedPersonId: null,
      action: "registration.delete",
      entityType: "registration",
      entityId: id,
      before: { state: row.state },
      after: { state: "withdrawn" },
      reason: null,
      scopeBuildings: [],
      meta: { source: "telegram", ownership_verified: true },
    });
  });
}
