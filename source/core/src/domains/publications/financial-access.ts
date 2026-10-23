import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { jsonValue, type Row } from "../registry/validation.ts";
import type { DocumentRow } from "../documents/types.ts";
import { documentResources, documentVersionReadable } from "../documents/access.ts";

export async function financialOwnerBuildings(exec: DbExecutor, actor: Actor): Promise<string[]> {
  const rows = await exec.query<{ building_id: string }>(
    `select distinct p.building_id from connection c join premises p on p.id=c.premises_id
     where c.person_id=$1 and c.role='owner' and c.status='active' and p.is_test=$2
     and (c.start_date is null or c.start_date<=(now() at time zone 'Asia/Almaty')::date)
     and (c.end_date is null or c.end_date>=(now() at time zone 'Asia/Almaty')::date)`, [actor.person.id, actor.person.isTest]);
  return rows.map(r => r.building_id);
}

interface Version extends Row {
  id: string; version: number; title: string; body: string; building_ids: string[];
  period_from: string; period_to: string; published_at: string | null; replaced_at: string | null;
  correction_note: string; approval_id: string | null;
  package_snapshot: unknown; publication_id: string;
}
export async function publicFinancialHeads(exec: DbExecutor, actor: Actor, ids: string[]) {
  if (!ids.length) return [];
  const owners = await financialOwnerBuildings(exec, actor);
  return exec.query<{ id: string; publication_id: string; version: number; title: string; body: string; building_ids: string[]; needs_fix: boolean }>(`select distinct on(f.publication_id) f.id,f.publication_id,f.version,f.title,f.body,f.building_ids,
    exists(select 1 from financial_package_document p join document_version d on d.id=p.document_version_id where p.financial_version_id=f.id and d.state='needs_fix') as needs_fix
    from financial_publication_version f
    join publication p on p.id=f.publication_id where f.publication_id=any($1::uuid[]) and p.is_test=$2
    and f.published_at is not null and f.building_ids && $3::uuid[] order by f.publication_id,f.version desc`, [ids, actor.person.isTest, owners]);
}
/** Снимки публичного архива не берутся из изменяемой строки черновика publication. */
export async function financialArchive(exec: DbExecutor, actor: Actor, id: string) {
  const owners = await financialOwnerBuildings(exec, actor);
  const rows = await exec.query<Version>(
    `select f.id,f.publication_id,f.version,f.title,f.body,f.building_ids,f.package_snapshot,to_char(f.period_from,'YYYY-MM-DD') as period_from,
     to_char(f.period_to,'YYYY-MM-DD') as period_to,f.published_at,f.replaced_at,f.correction_note,f.approval_id
     from financial_publication_version f join publication p on p.id=f.publication_id
     where p.id=$1 and p.is_test=$2 order by f.version desc`, [id, actor.person.isTest]);
  const allowed = rows.flatMap(row => {
    const access = { publicationAccess: { buildingIds: row.building_ids, isTest: actor.person.isTest, financial: true, member: false, owner: false, published: false } };
    const internal = can(actor, "publication.read", access).allow;
    if (!internal && (!row.published_at || !row.building_ids.some(b => owners.includes(b)))) return [];
    return [{ row, internal }];
  });
  const parts = allowed.length ? await exec.query<{ financial_version_id: string; document_version_id: string; code: string; disclosed: boolean }>(
    "select * from financial_package_document where financial_version_id=any($1::uuid[]) order by financial_version_id,code", [allowed.map(v => v.row.id)]) : [];
  const documents = parts.length ? await exec.query<DocumentRow>("select d.* from document d where id in (select document_id from document_version where id=any($1::uuid[]))", [parts.map(p => p.document_version_id)]) : [];
  const resources = await documentResources(exec, actor, documents);
  const accessByDocument = new Map(documents.map((d, i) => [d.id, resources[i]!]));
  const versions = parts.length ? await exec.query<{ id: string; document_id: string; state: string; was_published: boolean; attachment_id: string; signed_attachment_id: string | null }>("select id,document_id,state,was_published,attachment_id,signed_attachment_id from document_version where id=any($1::uuid[])", [parts.map(p => p.document_version_id)]) : [];
  return allowed.map(({ row, internal }) => ({
    id: row.id, version: row.version, title: row.title, body: row.body, building_ids: row.building_ids,
    period_from: row.period_from, period_to: row.period_to, correction_note: row.correction_note,
    published_at: row.published_at, replaced_at: row.replaced_at, approved: !!row.approval_id,
    needs_fix: parts.some(p => p.financial_version_id === row.id && versions.find(v => v.id === p.document_version_id)?.state === "needs_fix"),
    documents: parts.filter(p => p.financial_version_id === row.id && (internal || p.disclosed)).flatMap(p => {
      const version = versions.find(v => v.id === p.document_version_id), doc = documents.find(d => d.id === version?.document_id);
      const access = doc && accessByDocument.get(doc.id);
      if (!doc || !version || !access || !can(actor, "document.read", access).allow || !documentVersionReadable(actor, access, version)) return [];
      const pinned = jsonValue<{ documents: { id: string; title: string }[] }>(row.package_snapshot).documents.find(d => d.id === version.id);
      return [{ document_id: doc.id, document_version_id: version.id, title: pinned?.title ?? doc.title, code: p.code, state: version.state,
        attachment_id: version.attachment_id, signed_attachment_id: version.signed_attachment_id }];
    }),
  }));
}
