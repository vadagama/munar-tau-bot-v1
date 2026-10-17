import { ApiError } from "../../errors/api.ts";

export const INCIDENT_STATES = ["signal_check", "confirmed", "not_confirmed", "mitigation", "recovery_check", "completed"] as const;
export type IncidentState = typeof INCIDENT_STATES[number];
const transitions: Record<string, Partial<Record<IncidentState, IncidentState>>> = {
  confirm: { signal_check: "confirmed" },
  mark_unconfirmed: { signal_check: "not_confirmed" },
  recheck: { not_confirmed: "signal_check" },
  start_mitigation: { confirmed: "mitigation" },
  report_recovery: { mitigation: "recovery_check" },
  fail_check: { recovery_check: "mitigation" },
  complete: { recovery_check: "completed" },
  reopen: { completed: "mitigation" },
};
export function allowedIncidentActions(state: IncidentState): string[] {
  return Object.keys(transitions).filter(action => transitions[action]?.[state]);
}
export function nextIncidentState(state: IncidentState, action: string): IncidentState {
  const next = Object.hasOwn(transitions, action) ? transitions[action]?.[state] : undefined;
  if (!next) throw new ApiError("INVALID_TRANSITION", undefined, { state, allowed_actions: allowedIncidentActions(state) });
  return next;
}
/** EMG-05: сравниваются серверные идентификаторы зон, а не число отметок. */
export function requireFullRecovery(scopeIds: readonly string[], recoveredIds: readonly string[]): void {
  if (!scopeIds.length || new Set(recoveredIds).size !== recoveredIds.length ||
    scopeIds.length !== recoveredIds.length || !scopeIds.every(id => recoveredIds.includes(id))) {
    throw new ApiError("INVALID_TRANSITION", "Восстановление подтверждено не по всему охвату");
  }
}
