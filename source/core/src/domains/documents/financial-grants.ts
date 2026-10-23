import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";

/** FIN не публикует документ глобально: раскрытие действует в домах конкретного выпуска.
 * PDP источника и собственная аудитория документа проверяются независимо в access.ts.
 */
export async function financialDocumentGrants(exec: DbExecutor, actor: Actor, documentIds: string[]) {
  const rows = await exec.query<{ document_id: string; version_id: string }>(
    `select distinct v.document_id,v.id as version_id from financial_package_document part
     join financial_publication_version f on f.id=part.financial_version_id
     join publication pub on pub.id=f.publication_id join document_version v on v.id=part.document_version_id
     where part.disclosed and f.published_at is not null and pub.is_test=$2 and v.document_id=any($3::uuid[])
     and exists(select 1 from connection c join premises p on p.id=c.premises_id
       where c.person_id=$1 and c.status='active' and c.role='owner' and p.is_test=$2
       and p.building_id=any(f.building_ids)
       and (c.start_date is null or c.start_date<=(now() at time zone 'Asia/Almaty')::date)
       and (c.end_date is null or c.end_date>=(now() at time zone 'Asia/Almaty')::date))
     order by v.document_id,v.id`, [actor.person.id, actor.person.isTest, documentIds]);
  const grants = new Map<string, string[]>();
  for (const row of rows) grants.set(row.document_id, [...(grants.get(row.document_id) ?? []), row.version_id]);
  return grants;
}
