import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { checkedDocumentVersions } from "../documents/provider.ts";
import { requireDocument,documentResource,documentVersionReadable } from "../documents/access.ts";
import type { DocumentVersionRow } from "../documents/types.ts";
/** Порядок: gate → инициатива → документ → версия. Снимок формируется сервером. */
export async function checkedInitiativeDecision(exec:DbExecutor,actor:Actor,id:string,buildingIds:string[]) {
  const [checked]=await checkedDocumentVersions(exec,actor,[id],buildingIds);
  if(!checked || checked.kind!=="decision_basis")throw new ApiError("INVALID_TRANSITION");
  const doc=await requireDocument(exec,actor,checked.document_id,"document.read",true);
  const [version]=await exec.query<DocumentVersionRow>("select * from document_version where id=$1 and document_id=$2 for update",[id,doc.id]);
  if(!version || doc.is_test!==actor.person.isTest || doc.kind!=="decision_basis" || version.state!=="approved" ||
    !documentVersionReadable(actor,await documentResource(exec,actor,doc),version))throw new ApiError("INVALID_TRANSITION");
  return {id:version.id,document_id:doc.id,version:version.version,title:doc.title,document_number:doc.document_number,
    document_date:doc.document_date,attachment_id:version.attachment_id,signed_attachment_id:version.signed_attachment_id};
}
