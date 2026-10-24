// Журнал регистраций человека (REG-02a, решение владельца 24.10.2026).
// Список анкет кабинета схлопнут до одной строки на человека: история привязок
// (/add) и смен статусов доступна здесь — по клику на заявителя. Журнал читает
// все анкеты человека, включая привязки и исторические (superseded), и события
// audit_log по этим анкетам. Право — то же registration.review, что у списка:
// события повторяют историю уже видимых анкет.

import { can } from "../../pdp/evaluate.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { registryScope } from "../registry/access.ts";
import { jsonValue, type Row } from "../registry/validation.ts";
import type { RegistryDeps } from "../registry/service.ts";

export interface RegistrationJournal {
  person: { id: string; full_name: string; phone_e164: string | null };
  registrations: Row[];
  events: Row[];
}

export async function registrationJournal(
  deps: RegistryDeps,
  actor: Actor,
  personId: string,
): Promise<RegistrationJournal> {
  if (!can(actor, "registration.review").allow) throw new ApiError("FORBIDDEN");
  const scope = actor.assignments.some((a) => a.role === "tech_admin")
    ? null
    : registryScope(actor);
  const [person] = await deps.db.query<Row>(
    "select id,full_name,phone_e164,is_test from person where id=$1",
    [personId],
  );
  if (!person || person.is_test !== actor.person.isTest) throw new ApiError("NOT_FOUND");
  const [profile] = await deps.db.query<Row>(
    "select telegram_user_id from profile where person_id=$1 and archived_at is null order by id desc limit 1",
    [personId],
  );
  const registrations = await deps.db.query<Row>(
    `select r.id,r.person_id,r.telegram_user_id,r.premises_id,r.role,r.source,r.state,
      r.version,r.superseded_by,r.created_at,r.updated_at,r.decided_at,r.decided_reason,r.withdrawn_at,
      r.draft->>'full_name' as full_name,r.draft->>'phone_e164' as phone_e164,
      p.kind,p.number,b.code as building_code
    from registration r left join premises p on p.id=r.premises_id left join building b on b.id=p.building_id
    where (r.person_id=$1 or r.telegram_user_id=$2::bigint) and r.is_test=$3
      and ($4::uuid[] is null or r.premises_id is null or p.building_id=any($4::uuid[]))
    order by r.created_at asc,r.id asc`,
    [personId, profile?.telegram_user_id ?? null, actor.person.isTest, scope],
  );
  const ids = registrations.map((r) => String(r.id));
  const events = ids.length
    ? (
      await deps.db.query<Row>(
        `select a.at,a.action,a.before,a.after,a.reason,n.full_name as actor_name
      from audit_log a left join person n on n.id=a.actor_person_id
      where a.entity_type='registration' and a.entity_id=any($1::uuid[])
      order by a.at asc,a.id asc`,
        [ids],
      )
    ).map((event) => ({
      ...event,
      before: event.before == null ? null : jsonValue<Row>(event.before),
      after: event.after == null ? null : jsonValue<Row>(event.after),
    }))
    : [];
  return {
    person: {
      id: String(person.id),
      full_name: String(person.full_name),
      phone_e164: person.phone_e164 == null ? null : String(person.phone_e164),
    },
    registrations,
    events,
  };
}
