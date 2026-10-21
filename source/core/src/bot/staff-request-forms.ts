import type { Row } from "../domains/registry/validation.ts";
/** Fields deliberately follow domain commands, not a client-selected destination state. */
export function staffFormFields(
  action: string,
  request: Row,
  task?: Row,
): string[] {
  const fields: Record<string, string[]> = {
    start_review: [],
    ask_clarification: ["question", "reason", "task_policy"],
    resolve_clarification: ["reason"],
    start_work: ["assignee", "plan", "due_at"],
    add_task: ["assignee", "plan", "due_at", "required"],
    plan_rework: ["assignee", "plan", "due_at"],
    hold: ["reason", "next_action_at", "task_policy"],
    resume: ["reason"],
    submit_result: ["summary"],
    withdraw_report: ["reason"],
    approve_cancel: [
      "reason",
      ...(request.work_started_at ? ["stop_resolution"] : []),
    ],
    reject_cancel: ["reason"],
    reject: [
      "reason",
      "route",
      ...(request.work_started_at ? ["stop_resolution"] : []),
    ],
    uphold_appeal: ["reason"],
    admin_close: ["reason", "verification_method", "verification_materials"],
    answer: ["text"],
    note: ["text"],
    kind: ["kind", "reason"],
    category: ["category", "reason"],
    urgency: ["urgency", "reason"],
    place: ["building_code", "premises", "location_text", "reason"],
    task_assign: ["assignee", "reason"],
    task_cancel: [
      "reason",
      ...(task?.is_required ? ["replacement"] : []),
      "dependency_review",
    ],
    task_approve: ((task?.missing_evidence ?? []) as string[]).map((id) =>
      `evidence_reason:${id}`
    ),
    task_suspend: ["reason", "next_action_at"],
    task_resume: ["reason"],
    task_replace_canceled: ["reason", "replacement", "dependency_review"],
    task_return: [
      "reason",
      "plan",
      "rework_due_at",
      ...(task?.state === "accepted_admin" ? ["dependency_review"] : []),
    ],
  };
  return fields[action] ?? [];
}
export const STAFF_REQUEST_ACTIONS = [
  "start_review",
  "ask_clarification",
  "resolve_clarification",
  "start_work",
  "plan_rework",
  "hold",
  "resume",
  "submit_result",
  "withdraw_report",
  "approve_cancel",
  "reject_cancel",
  "reject",
  "uphold_appeal",
  "admin_close",
];
