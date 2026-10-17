import { ApiError } from "../../errors/api.ts";

/** Модель процессов §5. Проверка роли и предметных условий выполняется сервисом. */
export const TASK_STATES = [
  "created", "awaiting_acceptance", "accepted", "in_progress", "suspended",
  "on_review", "rework", "accepted_admin", "canceled",
] as const;
export type TaskState = typeof TASK_STATES[number];
export type ResumeState = "accepted" | "in_progress";
export const TASK_ACTIONS = [
  "assign", "accept", "decline", "start", "suspend", "resume", "report",
  "approve", "return", "reassign", "cancel",
] as const;
export type TaskAction = typeof TASK_ACTIONS[number];
const unfinished = TASK_STATES.filter((state) =>
  state !== "accepted_admin" && state !== "canceled"
);
const transitions: Record<TaskAction, Partial<Record<TaskState, TaskState>>> = {
  assign: { created: "awaiting_acceptance" },
  accept: { awaiting_acceptance: "accepted" },
  decline: { awaiting_acceptance: "created" },
  start: { accepted: "in_progress", rework: "in_progress" },
  suspend: { accepted: "suspended", in_progress: "suspended" },
  resume: {},
  report: { in_progress: "on_review" },
  approve: { on_review: "accepted_admin" },
  return: { on_review: "rework", accepted_admin: "rework" },
  reassign: Object.fromEntries(unfinished.map((state) => [state, "created"])),
  cancel: Object.fromEntries(unfinished.map((state) => [state, "canceled"])),
};

export function allowedTaskActions(state: TaskState): TaskAction[] {
  return TASK_ACTIONS.filter((action) =>
    (action === "resume" && state === "suspended") ||
    transitions[action][state] !== undefined
  );
}

export function nextTaskState(
  state: TaskState,
  action: string,
  previousState?: TaskState | null,
): TaskState {
  if (action === "resume" && state === "suspended" &&
    (previousState === "accepted" || previousState === "in_progress")) {
    return previousState;
  }
  const next = TASK_ACTIONS.includes(action as TaskAction)
    ? transitions[action as TaskAction][state]
    : undefined;
  if (!next) {
    throw new ApiError("INVALID_TRANSITION", undefined, {
      state, allowed_actions: allowedTaskActions(state),
    });
  }
  return next;
}

export type CommonWorkState =
  | "planned" | "in_progress" | "on_review" | "completed" | "canceled";
export interface TaskProgress {
  readonly state: TaskState;
  readonly isRequired: boolean;
  /** Не сбрасывается при переназначении: начало работ остаётся фактом. */
  readonly started: boolean;
}

export function requiredTasksAccepted(tasks: readonly TaskProgress[]): boolean {
  const required = tasks.filter((task) => task.isRequired);
  return required.length > 0 &&
    required.every((task) => task.state === "accepted_admin");
}

/** Завершение и отмена — явные действия администратора, не автопереходы. */
export function aggregateCommonWorkState(
  current: CommonWorkState,
  tasks: readonly TaskProgress[],
): CommonWorkState {
  if (current === "canceled") return current;
  if (tasks.some((task) => task.state === "rework")) return "in_progress";
  if (current === "completed" && requiredTasksAccepted(tasks)) return current;
  const required = tasks.filter((task) => task.isRequired);
  if (required.length > 0 && required.every((task) =>
    task.state === "on_review" || task.state === "accepted_admin"
  )) return "on_review";
  if (current === "completed" || tasks.some((task) =>
    task.started || ["in_progress", "on_review", "rework", "accepted_admin"].includes(task.state)
  )) return "in_progress";
  return "planned";
}
