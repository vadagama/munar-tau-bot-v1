import { content } from "../requests/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { DOCUMENT_AUDIENCES, DOCUMENT_KINDS } from "./types.ts";

export function documentInput(input: Row) {
  const kind = DOCUMENT_KINDS.find(v => v === input.kind);
  const audience = DOCUMENT_AUDIENCES.find(v => v === input.audience);
  if (!kind || !audience) invalid("Укажите вид и аудиторию документа");
  if (["invoice", "receipt"].includes(kind) && audience !== "finance") invalid("Расчётные документы имеют финансовую аудиторию");
  const ids = input.building_ids;
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) invalid("Некорректные дома документа");
  const date = input.document_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) invalid("Укажите дату документа");
  const request = input.request_id == null ? null : content(input.request_id);
  const task = input.task_id == null ? null : content(input.task_id);
  if (request && task) invalid("Выберите обращение либо задание");
  return {
    title: content(input.title), kind, audience, document_date: date,
    document_number: input.document_number == null || input.document_number === "" ? null : content(input.document_number),
    parties: content(input.parties), prepared_by: content(input.prepared_by), reviewer_id: content(input.reviewer_id),
    request_id: request, task_id: task, building_ids: ids as string[],
  };
}
export function versionInput(input: Row) {
  const attachment = content(input.attachment_id);
  const signed = input.signed_attachment_id == null ? null : content(input.signed_attachment_id);
  if (signed === attachment) invalid("Подписанный экземпляр хранится отдельно от черновика");
  return { attachment_id: attachment, signed_attachment_id: signed,
    signature_method: signed ? content(input.signature_method, "способ проверки подписи") : null,
    signature_basis: signed ? content(input.signature_basis, "основание проверки подписи") : null };
}
