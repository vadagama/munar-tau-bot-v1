import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { invalid, type Row } from "../registry/validation.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { requireTask } from "../tasks/access.ts";
import { createObligation, obligationInput } from "./obligations.ts";

export type DocumentRule = Omit<ReturnType<typeof obligationInput>, "request_id" | "task_id">;
export function documentRulesInput(value: unknown): DocumentRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) invalid("В методичке допускается до 20 документальных требований");
  const keys = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid("Некорректное требование документа");
    const parsed = obligationInput({ ...item as Row, task_id: "template", request_id: null });
    const rule: DocumentRule = { kind: parsed.kind, phase: parsed.phase, basis: parsed.basis,
      prepared_by: parsed.prepared_by, reviewer_id: parsed.reviewer_id, signed_required: parsed.signed_required };
    if (![rule.prepared_by, rule.reviewer_id].every(id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) invalid("Выберите зарегистрированных сотрудников");
    const key = `${rule.kind}:${rule.phase}`;
    if (keys.has(key)) invalid("Повтор типа и этапа документального требования");
    keys.add(key);
    return rule;
  });
}

/** Методичка фиксирует условия; полномочия людей и срок проверяются при применении. */
export async function applyTaskDocumentRules(deps: RegistryDeps, exec: DbExecutor, actor: Actor, taskId: string, rules: DocumentRule[], reason: string) {
  const transactional = { ...deps, db: { ...deps.db, query: exec.query.bind(exec), transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec) } };
  for (const [index, rule] of rules.entries()) {
    const task = await requireTask(exec, actor, taskId, "task.manage");
    await createObligation(transactional, actor, { ...rule, task_id: taskId, expected_version: task.version, reason }, `task-rule:${taskId}:${task.template_id}:${task.template_version}:${task.version}:${index}`);
  }
  return requireTask(exec, actor, taskId, "task.manage");
}
