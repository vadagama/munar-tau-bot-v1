import { ApiError } from "../../errors/api.ts";
import type { DocumentState } from "./types.ts";
const TRANSITIONS: Record<string, Partial<Record<DocumentState, DocumentState>>> = {
  submit: { draft: "on_review" }, approve: { on_review: "approved" },
  return: { on_review: "returned" }, needs_fix: { approved: "needs_fix" },
};
export function documentTransition(state: string, action: string): DocumentState {
  const next = TRANSITIONS[action]?.[state as DocumentState];
  if (!next) throw new ApiError("INVALID_TRANSITION");
  return next;
}
