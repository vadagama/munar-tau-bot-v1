import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import type { Actor } from "../../pdp/types.ts";
import { invalid, jsonValue } from "../registry/validation.ts";
import { documentResources } from "./access.ts";
import type { DocumentRow } from "./types.ts";

export interface CheckedDocumentVersion {
  id: string; document_id: string; version: number; kind: string; audience: string;
  state: string; is_test: boolean; building_ids: string[];
  title: string; document_date: string; document_number: string | null; parties: string;
  prepared_by: string; reviewer_id: string; version_prepared_by: string; reviewed_by: string | null;
  attachment_id: string; signed_attachment_id: string | null;
  signature_method: string | null; signature_basis: string | null;
}

/** Вызывается внутри бизнес-транзакции после блокировки родителя публикации.
 * Блокировка карточек сериализует проверку с needs_fix и изменением метаданных.
 * В снимок не входят изменяемые указатели публикации и технические отметки.
 */
export async function checkedDocumentVersions(exec: DbExecutor, actor: Actor, ids: string[], buildingIds: string[]): Promise<CheckedDocumentVersion[]> {
  if (!ids.length || ids.length > 31 || new Set(ids).size !== ids.length) invalid("Выберите неповторяющиеся версии документов (до 31)");
  const documents = await exec.query<DocumentRow>(
    "select d.* from document d where d.id in (select document_id from document_version where id=any($1::uuid[])) order by d.id for update", [ids]);
  const resources = await documentResources(exec, actor, documents);
  if (documents.some((_, index) => !can(actor, "document.read", resources[index]).allow)) throw new ApiError("NOT_FOUND");
  const versions = await exec.query<CheckedDocumentVersion & { complete: boolean }>(
    `select v.id,v.document_id,v.version,v.state,d.kind,d.audience,d.is_test,d.title,
     to_char(d.document_date,'YYYY-MM-DD') as document_date,d.document_number,d.parties,
     d.prepared_by,d.reviewer_id,v.prepared_by as version_prepared_by,v.reviewed_by,
     v.attachment_id,v.signed_attachment_id,v.signature_method,v.signature_basis,
     coalesce((select jsonb_agg(s.building_id order by s.building_id) from document_scope s where s.document_id=d.id),'[]'::jsonb) as building_ids,
     (a.status='complete' and a.owner_type='document' and a.owner_id=d.id and
       (v.signed_attachment_id is null or (signed.status='complete' and signed.owner_type='document' and signed.owner_id=d.id))) as complete
     from document_version v join document d on d.id=v.document_id join attachment a on a.id=v.attachment_id
     left join attachment signed on signed.id=v.signed_attachment_id where v.id=any($1::uuid[]) order by v.id`, [ids]);
  if (versions.length !== ids.length) invalid("Не найден полный комплект версий документов");
  return versions.map(({ complete, ...version }) => {
    version.building_ids = jsonValue<string[]>(version.building_ids);
    if (!complete || version.state !== "approved" || version.is_test !== actor.person.isTest ||
      (version.building_ids.length && buildingIds.some(id => !version.building_ids.includes(id)))) invalid("Документ не проверен, файл не сохранён или охват не соответствует публикации");
    return version;
  });
}
