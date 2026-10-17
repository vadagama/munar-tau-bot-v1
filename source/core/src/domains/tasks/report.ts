import { ApiError } from "../../errors/api.ts";

export interface EvidenceRequirement {
  readonly id: string;
  readonly required: boolean;
}
export interface ReportEvidence {
  readonly requirementId: string;
  readonly attachmentIds: readonly string[];
  readonly missingReason?: string;
}
export interface WorkReport {
  readonly performedWork: string;
  readonly performedAt: string;
  readonly result: string;
  readonly limitations: string;
  readonly evidence: readonly ReportEvidence[];
}

function invalid(message: string): never {
  throw new ApiError("VALIDATION_FAILED", message);
}

/** Подтверждённые файлы передаёт сервис после проверки Storage, владельца и PDP. */
export function validateReport(
  report: WorkReport,
  requirements: readonly EvidenceRequirement[],
  verifiedAttachmentIds: ReadonlySet<string>,
): readonly string[] {
  if (!report.performedWork.trim() || !report.result.trim()) {
    invalid("Укажите выполненный объём и результат");
  }
  if (!report.performedAt.trim() || !Number.isFinite(Date.parse(report.performedAt))) {
    invalid("Укажите время выполнения");
  }
  const known = new Set(requirements.map((requirement) => requirement.id));
  if (known.size !== requirements.length) invalid("Пункты чек-листа повторяются");
  const provided = new Map<string, ReportEvidence>();
  for (const evidence of report.evidence) {
    if (!known.has(evidence.requirementId) || provided.has(evidence.requirementId)) {
      invalid("Неизвестный или повторный пункт чек-листа");
    }
    if (evidence.attachmentIds.some((id) => !verifiedAttachmentIds.has(id))) {
      invalid("Доказательство не загружено или недоступно");
    }
    provided.set(evidence.requirementId, evidence);
  }
  const missing: string[] = [];
  for (const requirement of requirements) {
    if (!requirement.required) continue;
    const evidence = provided.get(requirement.id);
    if (evidence?.attachmentIds.length) continue;
    if (!evidence?.missingReason?.trim()) {
      invalid("Объясните отсутствие обязательного доказательства");
    }
    missing.push(requirement.id);
  }
  return missing;
}

/** Само объяснение исполнителя не заменяет явное решение администратора. */
export function validateEvidenceAcceptance(
  missing: readonly string[],
  decisions: readonly { readonly requirementId: string; readonly reason: string }[],
): void {
  const approved = new Set<string>();
  for (const decision of decisions) {
    if (!missing.includes(decision.requirementId) ||
      approved.has(decision.requirementId) || !decision.reason.trim()) {
      invalid("Укажите отдельное обоснованное решение по недостающему доказательству");
    }
    approved.add(decision.requirementId);
  }
  if (missing.some((id) => !approved.has(id))) {
    invalid("Не все недостающие доказательства рассмотрены администратором");
  }
}
