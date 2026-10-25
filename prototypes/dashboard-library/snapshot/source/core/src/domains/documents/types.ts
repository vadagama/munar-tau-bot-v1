import type { Row } from "../registry/validation.ts";
export const DOCUMENT_KINDS = ["act", "work_report", "invoice", "receipt", "decision_basis", "instruction", "financial_report", "other"] as const;
export const DOCUMENT_AUDIENCES = ["resident", "owner", "staff", "finance", "service"] as const;
export type DocumentState = "draft" | "on_review" | "returned" | "approved" | "needs_fix";
export interface DocumentRow extends Row {
  id: string; title: string; kind: typeof DOCUMENT_KINDS[number];
  audience: typeof DOCUMENT_AUDIENCES[number];
  request_id: string | null; task_id: string | null;
  prepared_by: string; reviewer_id: string;
  document_number: string | null; document_date: string;
  parties: string; is_test: boolean; version: number;
  published_version_id: string | null;
}
export interface DocumentVersionRow extends Row {
  id: string; document_id: string; version: number; state: DocumentState;
  attachment_id: string; signed_attachment_id: string | null;
  signature_method: string | null; signature_basis: string | null;
  prepared_by: string; reviewed_by: string | null;
  task_report_id: string | null;
  was_published: boolean; review_comment: string | null;
}
