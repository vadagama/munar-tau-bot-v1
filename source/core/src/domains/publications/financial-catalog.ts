import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { can } from "../../pdp/evaluate.ts";
import { invalid } from "../registry/validation.ts";
import { financialOwnerBuildings } from "./financial-access.ts";
interface PublishedHead { id: string; publication_id: string; title: string; version: number; building_ids: string[]; is_test: boolean; published_at: string }
/** Опубликованный снимок выбирается до страницы, независимо от черновика исправления. */
export async function listFinancialCatalogue(exec: DbExecutor, actor: Actor, audience: "owner" | "staff", offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) invalid("Некорректная страница финансовых отчётов");
  const [rows, owners] = await Promise.all([
    exec.query<PublishedHead>(`select f.id,f.publication_id,f.title,f.version,f.building_ids,p.is_test,f.published_at
      from financial_publication_version f join publication p on p.id=f.publication_id
      where p.is_test=$1 and p.kind='financial_report' and f.published_at is not null order by f.publication_id,f.version desc`, [actor.person.isTest]),
    financialOwnerBuildings(exec, actor),
  ]);
  const heads = new Map<string, PublishedHead>();
  for (const row of rows) {
    const owner = row.building_ids.some(id => owners.includes(id));
    const internal = audience === "staff" && can(actor, "publication.read", { publicationAccess: { buildingIds: row.building_ids, isTest: row.is_test, financial: true, published: false, member: false, owner: false } }).allow;
    if (row.is_test === actor.person.isTest && (owner || internal) && !heads.has(row.publication_id)) heads.set(row.publication_id, row);
  }
  const items = [...heads.values()].sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime() || a.publication_id.localeCompare(b.publication_id));
  return { items: items.slice(offset, offset + 10), has_more: items.length > offset + 10 };
}
