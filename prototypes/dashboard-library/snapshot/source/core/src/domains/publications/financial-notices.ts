import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { fmtDay } from "../../bot/text.ts";
import { templateNotice } from "../../templates/notice.ts";
import { financialOwnerBuildings } from "./financial-access.ts";
interface NoticeVersion { id: string; version: number; title: string; period_from: string; period_to: string; building_ids: string[]; correction_note: string }
export async function financialPublicationNotice(exec: DbExecutor, publicationId: string, versionId: string, isTest: boolean) {
  const [version] = await exec.query<NoticeVersion>(`select f.id,f.version,f.title,to_char(f.period_from,'YYYY-MM-DD') as period_from,
    to_char(f.period_to,'YYYY-MM-DD') as period_to,f.building_ids,f.correction_note from financial_publication_version f
    join publication p on p.id=f.publication_id where f.id=$1 and f.publication_id=$2 and p.is_test=$3 and f.published_at is not null`, [versionId, publicationId, isTest]);
  if (!version) throw new ApiError("INVALID_TRANSITION");
  return { key: `financial:${version.id}`, financialVersionId: version.id,
    scope: version.building_ids.map(building_id => ({ building_id, premises_ids: [] as string[] })),
    text: templateNotice(version.version > 1 ? "notices.financial.corrected" : "notices.financial.published", {
      title: version.title, version: version.version, period_from: fmtDay(version.period_from), period_to: fmtDay(version.period_to), correction_note: version.correction_note,
    }) };
}
/** Служебные полномочия не подменяют собственность в домах этого выпуска. */
export async function financialNoticeAllowed(exec: DbExecutor, actor: Actor, publicationId: string, versionId: string, targets: string[]) {
  const [version] = await exec.query<{ building_ids: string[] }>(`select f.building_ids from financial_publication_version f join publication p on p.id=f.publication_id
    where f.id=$1 and f.publication_id=$2 and p.is_test=$3 and f.published_at is not null`, [versionId, publicationId, actor.person.isTest]);
  if (!version) return false;
  const owners = await financialOwnerBuildings(exec, actor);
  return version.building_ids.some(id => targets.includes(id) && owners.includes(id));
}
