import type { Row } from "../registry/validation.ts";
export type PublicationState = "submitted" | "published" | "rejected";
export type InitiativeStage = "collecting" | "assessing" | "planned" | "implementing" | "completed" | "rejected" | "deferred";
export interface InitiativeRow extends Row {
  id:string; author_person_id:string; title:string; body:string; location_text:string;
  requested_building_ids:string[]; approved_building_ids:string[];
  publication_state:PublicationState; stage:InitiativeStage|null; is_test:boolean; version:number;
  created_at:Date|string; published_at:Date|string|null; completed_at:Date|string|null;
  review_reason:string|null; plan_basis:string|null; responsible_person_id:string|null;
  estimated_due_at:Date|string|null; owner_decision_required:boolean;
  decision_document_version_id:string|null; decision_snapshot:Row|null; final_support_count:number|null;
}
