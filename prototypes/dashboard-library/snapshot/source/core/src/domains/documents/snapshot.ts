import type { DbExecutor } from "../../db/client.ts";
import { invalid } from "../registry/validation.ts";
export interface ObligationResult {
  id: string; kind: string; task_id: string | null; request_id: string | null;
  document_id: string | null; document_version_id: string | null; state: string | null;
  signed_required: boolean; signed_attachment_id: string | null;
  task_report_id: string | null; expected_report_id: string | null;
  is_test: boolean; document_is_test: boolean | null; document_kind: string | null;
  document_task_id: string | null; document_request_id: string | null;
  prepared_by: string; reviewer_id: string; document_prepared_by: string | null; document_reviewer_id: string | null;
}
export function checkedDocumentSnapshot(rows: ObligationResult[], requiredActTasks: string[]) {
  if (requiredActTasks.some(id => !rows.some(r => r.task_id === id && r.kind === "act"))) invalid("Для обязательного акта не настроено документальное обязательство");
  return [...rows].sort((a, b) => a.id.localeCompare(b.id)).map(r => {
    if (!r.document_id || !r.document_version_id || r.state !== "approved" || r.is_test !== r.document_is_test ||
      r.kind !== r.document_kind || r.task_id !== r.document_task_id || r.request_id !== r.document_request_id ||
      r.prepared_by !== r.document_prepared_by || r.reviewer_id !== r.document_reviewer_id ||
      (r.signed_required && !r.signed_attachment_id) ||
      (r.task_id && ["act", "work_report"].includes(r.kind) && (!r.expected_report_id || r.task_report_id !== r.expected_report_id))) invalid("Не готов проверенный обязательный комплект документов");
    return { requirement_id: r.id, document_id: r.document_id, document_version_id: r.document_version_id };
  });
}
/** Родитель уже заблокирован вызывающим WRK/REQ; документы блокируются до обязанностей. */
export async function documentObligationSnapshot(exec: DbExecutor, requestId: string | null, taskIds: string[], requiredActTasks: string[]) {
  const params = [requestId, taskIds];
  await exec.query(`select d.id from document d where d.id in (
    select v.document_id from document_obligation o join document_version v on v.id=o.document_version_id
    where o.phase='before_acceptance' and (o.request_id=$1 or o.task_id=any($2::uuid[]))) order by d.id for update`, params);
  const rows = await exec.query<ObligationResult>(
    `select o.*,v.document_id,v.state,v.signed_attachment_id,v.task_report_id,d.is_test as document_is_test,
     d.kind as document_kind,d.task_id as document_task_id,d.request_id as document_request_id,
     d.prepared_by as document_prepared_by,d.reviewer_id as document_reviewer_id,
     (select r.id from task_report r where r.task_id=o.task_id order by r.version desc limit 1) as expected_report_id
     from document_obligation o left join document_version v on v.id=o.document_version_id left join document d on d.id=v.document_id
     where o.phase='before_acceptance' and (o.request_id=$1 or o.task_id=any($2::uuid[])) order by o.id for update of o`, params);
  return checkedDocumentSnapshot(rows, requiredActTasks);
}
