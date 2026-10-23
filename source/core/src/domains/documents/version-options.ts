import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid } from "../registry/validation.ts";
import type { DocumentRow, DocumentVersionRow } from "./types.ts";
import { documentResources, documentVersionReadable } from "./access.ts";

/** Каталог выбора возвращает только проверенные и доступные конкретные версии. */
export async function listDocumentVersionOptions(deps: RegistryDeps, actor: Actor, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) invalid("Некорректная страница версий");
  const documents = await deps.db.query<DocumentRow>("select * from document where is_test=$1 order by created_at desc,id", [actor.person.isTest]);
  const resources = await documentResources(deps.db, actor, documents);
  const allowed = documents.flatMap((document, i) => can(actor, "document.read", resources[i]).allow ? [{ document, resource: resources[i]! }] : []);
  const versions = allowed.length ? await deps.db.query<DocumentVersionRow>(`select v.* from document_version v join attachment a on a.id=v.attachment_id
    left join attachment s on s.id=v.signed_attachment_id where v.document_id=any($1::uuid[]) and v.state='approved'
    and a.status='complete' and a.owner_type='document' and a.owner_id=v.document_id
    and (v.signed_attachment_id is null or (s.status='complete' and s.owner_type='document' and s.owner_id=v.document_id))
    order by v.created_at desc,v.id`, [allowed.map(d => d.document.id)]) : [];
  const items = versions.flatMap(version => {
    const source = allowed.find(d => d.document.id === version.document_id);
    if (!source || !documentVersionReadable(actor, source.resource, version)) return [];
    return [{ id: version.id, document_id: source.document.id, title: source.document.title, kind: source.document.kind,
      audience: source.document.audience, version: version.version, signed: !!version.signed_attachment_id }];
  });
  return { items: items.slice(offset, offset + 200), has_more: items.length > offset + 200 };
}
