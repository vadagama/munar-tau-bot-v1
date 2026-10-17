import { ApiError } from "../../errors/api.ts";
export const STATES = [
  "draft",
  "new",
  "reviewing",
  "need_clarification",
  "in_work",
  "on_hold",
  "awaiting_confirmation",
  "rework",
  "closed",
  "canceled",
  "rejected",
] as const;
export type RequestState = typeof STATES[number];
export const CLOSED_STATES: readonly string[] = [
  "closed",
  "canceled",
  "rejected",
];
const transitions: Record<string, Partial<Record<RequestState, RequestState>>> =
  {
    submit: { draft: "new" },
    start_review: { new: "reviewing" },
    ask_clarification: {
      new: "need_clarification",
      reviewing: "need_clarification",
      in_work: "need_clarification",
      rework: "need_clarification",
    },
    answer_clarification: { need_clarification: "reviewing" },
    resolve_clarification: { need_clarification: "reviewing" },
    start_work: { reviewing: "in_work" },
    plan_rework: { rework: "in_work" },
    hold: {
      reviewing: "on_hold",
      in_work: "on_hold",
      need_clarification: "on_hold",
      rework: "on_hold",
    },
    resume: { on_hold: "reviewing" },
    submit_result: {
      reviewing: "awaiting_confirmation",
      in_work: "awaiting_confirmation",
    },
    confirm_result: { awaiting_confirmation: "closed" },
    admin_close: { awaiting_confirmation: "closed" },
    return_result: { awaiting_confirmation: "rework" },
    reopen: { closed: "rework" },
    withdraw_report: { awaiting_confirmation: "in_work" },
    cancel_request: {
      new: "new",
      reviewing: "reviewing",
      need_clarification: "need_clarification",
      in_work: "in_work",
      on_hold: "on_hold",
      awaiting_confirmation: "awaiting_confirmation",
      rework: "rework",
    },
    approve_cancel: {
      new: "canceled",
      reviewing: "canceled",
      need_clarification: "canceled",
      in_work: "canceled",
      on_hold: "canceled",
      awaiting_confirmation: "canceled",
      rework: "canceled",
    },
    reject_cancel: {
      new: "new",
      reviewing: "reviewing",
      need_clarification: "need_clarification",
      in_work: "in_work",
      on_hold: "on_hold",
      awaiting_confirmation: "awaiting_confirmation",
      rework: "rework",
    },
    reject: {
      new: "rejected",
      reviewing: "rejected",
      need_clarification: "rejected",
      in_work: "rejected",
      rework: "rejected",
      on_hold: "rejected",
    },
    appeal_reject: { rejected: "rejected" },
    uphold_appeal: { rejected: "reviewing" },
  };
export function allowedActions(state: RequestState): string[] {
  return Object.keys(transitions).filter((action) =>
    transitions[action]?.[state] !== undefined
  );
}
export function nextState(state: RequestState, action: string): RequestState {
  const next = transitions[action]?.[state];
  if (!next) {
    throw new ApiError("INVALID_TRANSITION", undefined, {
      state,
      allowed_actions: allowedActions(state),
    });
  }
  return next;
}
export function checkVersion(current: number, expected: unknown): void {
  if (!Number.isSafeInteger(expected) || current !== expected) {
    throw new ApiError("CONCURRENT_MODIFICATION");
  }
}
