// Операции администрирования VS-1 (ROL-02, ROL-04, AUTH-06): назначения и
// отзыв сеансов. Каждая операция — одна транзакция и записи журнала (AUD-01);
// под эмуляцией они недоступны — PDP блокирует admin.* до сервиса.
// Решение о доступе принимает PDP в конвейере; сервис проверяет только
// целостность данных (существование, состояние, окно полномочий).

import { ApiError } from "../../errors/api.ts";
import type { DbExecutor, DbTransactionRunner } from "../../db/client.ts";
import { buildAuditInput } from "../audit/entry.ts";
import type { AuditRepo } from "../audit/port.ts";
import type {
  AccessSessionRecord,
  AdminRepo,
  AssignmentFieldPatch,
  AssignmentListRecord,
  NewAssignmentInput,
} from "./port.ts";
import type { Actor } from "../../pdp/types.ts";

/** Зависимости операций: репозитории и владелец транзакций. */
export interface AdminServiceDeps {
  admin: AdminRepo;
  audit: AuditRepo;
  tx: DbTransactionRunner;
}

/** Снимок назначения для журнала — в формате JSON API (snake_case). */
function assignmentSnapshot(record: AssignmentListRecord): Record<string, unknown> {
  return {
    id: record.id,
    person_id: record.personId,
    role: record.role,
    financial_rights: record.financialRights,
    registry_export_rights: record.registryExportRights,
    regulations_rights: record.regulationsRights,
    status: record.status,
    valid_from: record.validFrom,
    valid_until: record.validUntil,
    scope_building_ids: record.scopeBuildingIds,
  };
}

function assertWindow(input: { validFrom: string | null; validUntil: string | null }): void {
  if (input.validFrom !== null && input.validUntil !== null) {
    if (new Date(input.validUntil).getTime() <= new Date(input.validFrom).getTime()) {
      throw new ApiError("VALIDATION_FAILED", "Срок полномочий раньше начала (ROL-03)");
    }
  }
}

async function requireActiveAssignment(
  admin: AdminRepo,
  exec: DbExecutor,
  assignmentId: string,
): Promise<AssignmentListRecord> {
  const record = await admin.getAssignment(exec, assignmentId);
  if (!record) {
    throw new ApiError("NOT_FOUND", "Назначение не найдено");
  }
  if (record.status !== "active") {
    throw new ApiError("INVALID_TRANSITION", "Назначение уже отозвано");
  }
  return record;
}

/**
 * Создание назначения (ROL-02). Проверку полномочий (кто какую роль назначает,
 * ROL-02a/b/c и область) выполняет PDP; здесь — существование персоны и окно.
 */
export async function createAssignment(
  deps: AdminServiceDeps,
  actor: Actor,
  input: NewAssignmentInput,
): Promise<AssignmentListRecord> {
  assertWindow(input);
  return deps.tx.transaction(async (exec) => {
    const person = await deps.admin.getPerson(exec, input.personId);
    if (!person || person.status !== "active") {
      throw new ApiError("VALIDATION_FAILED", "Персона не найдена или архивна");
    }
    const assignmentId = await deps.admin.insertAssignment(exec, input);
    if (input.scopeBuildingIds.length > 0) {
      await deps.admin.replaceAssignmentScope(exec, assignmentId, input.scopeBuildingIds);
    }
    const created = await deps.admin.getAssignment(exec, assignmentId);
    if (!created) {
      throw new ApiError("INTERNAL", "Назначение не найдено после создания");
    }
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "admin.assignment.create",
      entityType: "staff_assignment",
      entityId: created.id,
      after: assignmentSnapshot(created),
      buildingIds: created.scopeBuildingIds,
    }));
    return created;
  });
}

/**
 * Правка назначения (ROL-02): спецправа, срок, область. Отзыв — отдельная
 * операция revokeAssignment (недопустимый переход отличим от правки).
 */
export async function updateAssignment(
  deps: AdminServiceDeps,
  actor: Actor,
  assignmentId: string,
  patch: AssignmentFieldPatch & { scopeBuildingIds?: string[] },
): Promise<AssignmentListRecord> {
  const hasFieldChange =
    patch.financialRights !== undefined ||
    patch.registryExportRights !== undefined ||
    patch.regulationsRights !== undefined ||
    patch.validUntil !== undefined ||
    patch.scopeBuildingIds !== undefined;
  if (!hasFieldChange) {
    throw new ApiError("VALIDATION_FAILED", "Не указано ни одного поля для правки");
  }

  return deps.tx.transaction(async (exec) => {
    const before = await requireActiveAssignment(deps.admin, exec, assignmentId);
    if (patch.validUntil !== undefined && patch.validUntil !== null) {
      assertWindow({ validFrom: before.validFrom, validUntil: patch.validUntil });
    }

    const fieldsOnly: AssignmentFieldPatch = {
      financialRights: patch.financialRights,
      registryExportRights: patch.registryExportRights,
      regulationsRights: patch.regulationsRights,
      validUntil: patch.validUntil,
    };
    const updated = await deps.admin.updateAssignmentFields(exec, assignmentId, fieldsOnly);
    if (!updated) {
      throw new ApiError("INVALID_TRANSITION", "Назначение уже отозвано");
    }
    if (patch.scopeBuildingIds !== undefined) {
      await deps.admin.replaceAssignmentScope(exec, assignmentId, patch.scopeBuildingIds);
    }
    const after = await deps.admin.getAssignment(exec, assignmentId);
    if (!after) {
      throw new ApiError("INTERNAL", "Назначение не найдено после правки");
    }
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "admin.assignment.update",
      entityType: "staff_assignment",
      entityId: after.id,
      before: assignmentSnapshot(before),
      after: assignmentSnapshot(after),
      buildingIds: after.scopeBuildingIds,
    }));
    return after;
  });
}

/**
 * Отзыв назначения (ROL-03/04): активные сеансы человека отзываются тем же
 * действием — следующий запрос из открытого сеанса не пройдёт. В журнал —
 * две записи: отзыв назначения и отзыв сеансов.
 */
export async function revokeAssignment(
  deps: AdminServiceDeps,
  actor: Actor,
  assignmentId: string,
  reason: string,
  now: Date,
): Promise<AssignmentListRecord> {
  return deps.tx.transaction(async (exec) => {
    const target = await requireActiveAssignment(deps.admin, exec, assignmentId);

    const revoked = await deps.admin.revokeAssignment(exec, assignmentId, actor.person.id);
    if (!revoked) {
      throw new ApiError("INVALID_TRANSITION", "Назначение уже отозвано");
    }
    const after = await deps.admin.getAssignment(exec, assignmentId);
    if (!after) {
      throw new ApiError("INTERNAL", "Назначение не найдено после отзыва");
    }

    const sessionsRevoked = await deps.admin.revokeSessionsForPerson(
      exec,
      target.personId,
      reason,
      now,
    );

    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "admin.assignment.revoke",
      entityType: "staff_assignment",
      entityId: target.id,
      before: assignmentSnapshot(target),
      after: assignmentSnapshot(after),
      reason,
      buildingIds: target.scopeBuildingIds,
    }));
    if (sessionsRevoked > 0) {
      await deps.audit.append(exec, buildAuditInput(actor, {
        action: "admin.session.revoke",
        entityType: "access_session",
        reason,
        meta: { count: sessionsRevoked, person_id: target.personId },
      }));
    }
    return after;
  });
}

/**
 * Отзыв сеанса (AUTH-06): председатель/техадмин отзывают любой, каждый — свой.
 * Повторный отзыв — недопустимый переход, а не молчаливый успех.
 */
export async function revokeAccessSessionById(
  deps: AdminServiceDeps,
  actor: Actor,
  sessionId: string,
  reason: string,
  now: Date,
): Promise<AccessSessionRecord> {
  return deps.tx.transaction(async (exec) => {
    const session = await deps.admin.getAccessSession(exec, sessionId);
    if (!session) {
      throw new ApiError("NOT_FOUND", "Сеанс не найден");
    }
    const revoked = await deps.admin.revokeAccessSession(exec, sessionId, reason, now);
    if (!revoked) {
      throw new ApiError("INVALID_TRANSITION", "Сеанс уже завершён");
    }
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "admin.session.revoke",
      entityType: "access_session",
      entityId: sessionId,
      before: { revoked_at: null },
      after: { revoked_at: revoked.revokedAt, revoked_reason: reason },
      reason,
    }));
    return revoked;
  });
}
