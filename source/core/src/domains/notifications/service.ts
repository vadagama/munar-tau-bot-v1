import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { jsonValue } from "../registry/validation.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { SqlAdminRepo } from "../admin/repo.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
import { requireRequest } from "../requests/access.ts";
import { deliveryMode, type EventType, type PreferenceMode } from "./policy.ts";

export interface NoticeOptions {
  type?: EventType;
  requestId?: string;
  registrationAccess?: { premisesId: string; role: string };
  audience?: "personal" | "resident" | "staff" | "publication";
  important?: boolean;
  buildingIds?: string[];
  isTest?: boolean;
}
export interface Notice extends NoticeOptions {
  personId: string;
  text: string | { ru: string; kk: string };
  key: string;
}
/** Вызывается в бизнес-транзакции; сеть выполняется только диспетчером. */
export async function enqueueNotice(exec: DbExecutor, notice: Notice) {
  await exec.query(
    "insert into outbox(event_type,payload,dedup_key) values ('notification.requested',$1::text::jsonb || jsonb_build_object('isTest',coalesce(($1::text::jsonb->>'isTest')::boolean,(select is_test from person where id=$3))),$2) on conflict(dedup_key) where dedup_key is not null do nothing",
    [JSON.stringify(notice), notice.key, notice.personId],
  );
}
export async function recipientActor(
  exec: DbExecutor,
  personId: string,
): Promise<Actor | null> {
  const [row] = await exec.query<{ id: string }>(
    "select p.id from profile p join person n on n.id=p.person_id where p.person_id=$1 and p.archived_at is null and n.status='active'",
    [personId],
  );
  if (!row) return null;
  const repo = new SqlAdminRepo(),
    profile = await repo.getProfile(exec, row.id);
  return profile ? buildActorForProfile(repo, exec, profile, new Date()) : null;
}
export async function noticeAllowed(
  exec: DbExecutor,
  actor: Actor,
  notice: NoticeOptions,
): Promise<boolean> {
  if (notice.isTest !== undefined && notice.isTest !== actor.person.isTest) {
    return false;
  }
  if (notice.registrationAccess) {
    const { premisesId, role } = notice.registrationAccess;
    const [premises] = await exec.query<
      { building_id: string; is_test: boolean }
    >(
      "select building_id,is_test from premises where id=$1",
      [premisesId],
    );
    if (!premises || premises.is_test !== actor.person.isTest) return false;
    if (role === "owner") {
      const [owner] = await exec.query(
        "select id from connection where person_id=$1 and premises_id=$2 and role='owner' and status='active'",
        [actor.person.id, premisesId],
      );
      if (!owner) return false;
    } else if (
      !can(actor, "registration.review").allow ||
      !actor.assignments.some((a) =>
        a.role === "chairman" ||
        (a.role === role && a.scopeBuildingIds?.includes(premises.building_id))
      )
    ) return false;
  }
  if (notice.requestId) {
    try {
      await requireRequest(
        exec,
        actor,
        notice.requestId,
        notice.audience === "staff" ? "request.manage" : "request.read",
      );
    } catch (e) {
      if (
        e instanceof ApiError && ["NOT_FOUND", "FORBIDDEN"].includes(e.code)
      ) return false;
      throw e;
    }
  }
  if (notice.audience === "publication") {
    const [access] = await exec.query<{ ok: boolean }>(
      `select exists(select 1 from connection c join premises p on p.id=c.premises_id where c.person_id=$1 and c.status='active' and p.is_test=$3 and p.building_id=any($2::uuid[])) as ok`,
      [actor.person.id, notice.buildingIds ?? [], actor.person.isTest],
    );
    return access?.ok ?? false;
  }
  return true;
}
export async function preference(
  exec: DbExecutor,
  personId: string,
  type: EventType,
): Promise<PreferenceMode> {
  const [row] = await exec.query<{ mode: PreferenceMode }>(
    "select mode from notification_pref where person_id=$1 and event_type=$2",
    [personId, type],
  );
  return deliveryMode(type, row?.mode);
}
export async function getPreferences(exec: DbExecutor, actor: Actor) {
  if (!can(actor, "notification.preferences").allow) {
    throw new ApiError("FORBIDDEN");
  }
  const rows = await exec.query<{ event_type: string; mode: PreferenceMode }>(
    "select event_type,mode from notification_pref where person_id=$1",
    [actor.person.id],
  );
  return {
    language: actor.profile.language,
    items: ["publication", "work.report", "request.status"].map(
      (event_type) => ({
        event_type,
        mode: rows.find((r) => r.event_type === event_type)?.mode ??
          "immediate",
      }),
    ),
    mandatory: ["request.required", "incident"],
  };
}
export async function setPreference(
  deps: RegistryDeps,
  actor: Actor,
  type: unknown,
  mode: unknown,
  language?: unknown,
) {
  if (
    !can(actor, "notification.preferences").allow ||
    actor.person.status !== "active"
  ) throw new ApiError("FORBIDDEN");
  if (
    typeof type !== "string" ||
    !["publication", "work.report", "request.status"].includes(type) ||
    !["immediate", "digest", "off"].includes(String(mode)) ||
    (type === "request.status" && mode === "digest") ||
    (language !== undefined && !["ru", "kk"].includes(String(language)))
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Обязательные уведомления не отключаются",
    );
  }
  return deps.db.transaction(async (exec) => {
    await exec.query(
      "insert into notification_pref(person_id,event_type,mode) values ($1,$2,$3) on conflict(person_id,event_type) do update set mode=excluded.mode,updated_at=now()",
      [actor.person.id, type, mode],
    );
    if (language) {
      await exec.query("update profile set language=$2 where id=$1", [
        actor.profile.id,
        language,
      ]);
    }
    await recordAudit(
      deps,
      exec,
      actor,
      "notification.preferences",
      "person",
      actor.person.id,
      [],
      null,
      { event_type: type, mode, language },
    );
    return getPreferences(exec, {
      ...actor,
      profile: {
        ...actor.profile,
        language: (language ?? actor.profile.language) as "ru" | "kk",
      },
    });
  });
}
export async function dispatchNotices(
  deps: RegistryDeps,
  deadline = Date.now() + 45000,
): Promise<number> {
  return deps.db.transaction(async (exec) => {
    const rows = await exec.query<{ id: string; payload: unknown }>(
      "select id,payload from outbox where event_type='notification.requested' and processed_at is null and attempts<5 and next_attempt_at<=now() order by id for update skip locked limit 100",
    );
    let count = 0;
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      await exec.query("savepoint notice_dispatch");
      try {
        const n = jsonValue<Notice>(row.payload),
          actor = await recipientActor(exec, n.personId);
        if (actor && await noticeAllowed(exec, actor, n)) {
          const type = n.type ?? "personal",
            mode = await preference(exec, n.personId, type);
          const text = typeof n.text === "string"
            ? n.text
            : n.text[actor.profile.language];
          if (mode === "digest") {
            await exec.query(
              "insert into notification_digest_item(recipient_person_id,event_type,dedup_key,text,building_ids,is_test) values ($1,$2,$3,$4,$5::uuid[],$6) on conflict(dedup_key) do nothing",
              [
                n.personId,
                type,
                n.key,
                text,
                n.buildingIds ?? [],
                actor.person.isTest,
              ],
            );
          } else if (mode === "immediate") {
            await exec.query(
              `insert into notification(telegram_user_id,text,dedup_key,recipient_person_id,channel,event_type,event_ref,important,priority,request_id,audience,is_test)
 select telegram_user_id,$2,$3,person_id,case when is_test then 'simulator' else 'telegram' end,$4,$5::text::jsonb,$6,$7,$8,$9,is_test from profile where id=$1 on conflict(dedup_key) do nothing`,
              [
                actor.profile.id,
                text,
                n.key,
                type,
                JSON.stringify({
                  buildingIds: n.buildingIds ?? [],
                  registrationAccess: n.registrationAccess,
                }),
                n.important ?? type === "request.required",
                type === "incident" ? 0 : 1,
                n.requestId ?? null,
                n.audience ?? "personal",
              ],
            );
          }
        }
        await exec.query("update outbox set processed_at=now() where id=$1", [
          row.id,
        ]);
        await exec.query("release savepoint notice_dispatch");
      } catch {
        await exec.query("rollback to savepoint notice_dispatch");
        const [failed] = await exec.query<{ attempts: number }>(
          "update outbox set attempts=attempts+1,last_error='DISPATCH_FAILED',next_attempt_at=now()+interval '5 minutes' where id=$1 returning attempts",
          [row.id],
        );
        if (failed?.attempts === 5) {
          const n = jsonValue<Notice>(row.payload);
          // Ошибка подготовки тоже видна в журнале; содержимое события не раскрываем.
          // При недоступной БД вся транзакция откатится и событие останется повторяемым.
          await exec.query(
            `insert into notification(telegram_user_id,text,dedup_key,recipient_person_id,channel,event_type,event_ref,important,request_id,audience,is_test,state,attempts,last_error)
 select telegram_user_id,'Не удалось подготовить уведомление / Хабарламаны дайындау мүмкін болмады',$2,person_id,case when is_test then 'simulator' else 'telegram' end,$3,$4::text::jsonb,$5,$6,$7,is_test,'failed',5,'DISPATCH_FAILED' from profile where person_id=$1 and archived_at is null on conflict(dedup_key) do nothing`,
            [
              n.personId,
              n.key,
              n.type ?? "personal",
              JSON.stringify({
                buildingIds: n.buildingIds ?? [],
                registrationAccess: n.registrationAccess,
              }),
              n.important ?? n.type === "request.required",
              n.requestId ?? null,
              n.audience ?? "personal",
            ],
          );
        }
        await exec.query("release savepoint notice_dispatch");
      }
      count++;
    }
    return count;
  });
}
