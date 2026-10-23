import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { documentResources, documentVersionReadable } from "../documents/access.ts";
import type { DocumentRow, DocumentVersionRow } from "../documents/types.ts";
/** Выбор редактора ограничен PDP документа, источника и конкретной версии. */
export async function publicationDocumentSelection(exec: DbExecutor, actor: Actor, publicationId: string) {
  const pins = await exec.query<{ document_version_id: string }>("select document_version_id from publication_document where publication_id=$1 order by document_version_id", [publicationId]);
  const ids = pins.map(p => p.document_version_id);
  if (!ids.length) return { document_version_ids: [], document_versions: [], document_selection_incomplete: false };
  const documents = await exec.query<DocumentRow>("select * from document where is_test=$1 and id in (select document_id from document_version where id=any($2::uuid[])) order by id", [actor.person.isTest, ids]);
  const resources = await documentResources(exec, actor, documents);
  const versions = await exec.query<DocumentVersionRow & { complete: boolean }>(`select v.*,
    (a.status='complete' and a.owner_type='document' and a.owner_id=v.document_id and
      (v.signed_attachment_id is null or (s.status='complete' and s.owner_type='document' and s.owner_id=v.document_id))) as complete
    from document_version v left join attachment a on a.id=v.attachment_id left join attachment s on s.id=v.signed_attachment_id
    where v.id=any($1::uuid[]) order by v.id`, [ids]);
  const options = versions.flatMap(version => {
    const index = documents.findIndex(d => d.id === version.document_id), document = documents[index], resource = resources[index];
    if (!document || !resource || !can(actor, "document.read", resource).allow || !documentVersionReadable(actor, resource, version)) return [];
    return [{ id: version.id, document_id: document.id, title: document.title, kind: document.kind, audience: document.audience,
      version: version.version, signed: !!version.signed_attachment_id, available: version.state === "approved" && !!version.complete }];
  });
  return { document_version_ids: options.map(v => v.id), document_versions: options, document_selection_incomplete: options.length !== pins.length };
}
