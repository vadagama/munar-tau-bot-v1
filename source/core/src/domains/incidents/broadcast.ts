import type { TemplateNotice } from "../../templates/notice.ts";
import { esc } from "../../bot/text.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { jsonValue } from "../registry/validation.ts";
import { enqueueNotice } from "../notifications/service.ts";
import type { AudienceScope } from "./audience.ts";
export async function queueBroadcast(
  exec: DbExecutor,
  input: {
    key: string;
    type: "incident" | "publication" | "work.report";
    text: { ru: string; kk: string } | TemplateNotice;
    scope: AudienceScope[];
    isTest: boolean;
    incidentId?: string;
    publicationId?: string;
    financialVersionId?: string;
  },
) {
  await exec.query(
    "insert into broadcast(dedup_key,event_type,text,scope,is_test,incident_id,publication_id,financial_version_id) values($1,$2,$3::text::jsonb,$4::text::jsonb,$5,$6,$7,$8) on conflict(dedup_key) do nothing",
    [
      input.key,
      input.type,
      JSON.stringify("template" in input.text ? input.text : { ru: esc(input.text.ru), kk: esc(input.text.kk) }),
      JSON.stringify(input.scope),
      input.isTest,
      input.incidentId ?? null,
      input.publicationId ?? null,
      input.financialVersionId ?? null,
    ],
  );
}
export async function fanoutBroadcasts(
  deps: RegistryDeps,
  deadline = Date.now() + 10000,
): Promise<number> {
  let count = 0;
  for (let batch = 0; batch < 5 && Date.now() < deadline; batch++) {
    const processed = await deps.db.transaction(async (exec) => {
      const [row] = await exec.query<
        {
          id: string;
          event_type: "incident" | "publication" | "work.report";
          text: unknown;
          scope: unknown;
          is_test: boolean;
          cursor_person_id: string | null;
          incident_id: string | null;
          publication_id: string | null;
          financial_version_id: string | null;
        }
      >("select * from broadcast where completed_at is null order by created_at for update skip locked limit 1");
      if (!row) return 0;
      const scope = jsonValue<AudienceScope[]>(row.scope);
      const people = await exec.query<{ id: string }>(
        `select distinct c.person_id as id from connection c join premises p on p.id=c.premises_id join person n on n.id=c.person_id
   where c.status='active' and n.status='active' and n.is_test=$1 and p.is_test=$1 and ($2::uuid is null or c.person_id>$2::uuid)
   and (not exists(select 1 from publication f where f.id=$4 and f.kind='financial_report') or
     (c.role='owner' and (c.start_date is null or c.start_date<=(now() at time zone 'Asia/Almaty')::date)
      and (c.end_date is null or c.end_date>=(now() at time zone 'Asia/Almaty')::date)))
   and exists(select 1 from jsonb_array_elements($3::text::jsonb) s where p.building_id=(s->>'building_id')::uuid and
   (jsonb_array_length(s->'premises_ids')=0 or s->'premises_ids' ? p.id::text)) order by c.person_id limit 50`,
        [row.is_test, row.cursor_person_id, JSON.stringify(scope), row.publication_id],
      );
      for (const person of people) {
        if (Date.now() >= deadline) break;
        await enqueueNotice(exec, {
          personId: person.id,
          key: `broadcast:${row.id}:${person.id}`,
          text: jsonValue(row.text),
          type: row.event_type,
          audience: "publication",
          important: row.event_type === "incident",
          buildingIds: [...new Set(scope.map((s) => s.building_id))],
          scope,
          isTest: row.is_test,
          incidentId: row.incident_id ?? undefined,
          publicationId: row.publication_id ?? undefined,
          financialVersionId: row.financial_version_id ?? undefined,
        });
        await exec.query(
          "update broadcast set cursor_person_id=$2 where id=$1",
          [row.id, person.id],
        );
        count++;
      }
      if (!people.length) {
        await exec.query(
          "update broadcast set completed_at=now() where id=$1",
          [row.id],
        );
      }
      return 1;
    });
    if (!processed) break;
  }
  return count;
}
