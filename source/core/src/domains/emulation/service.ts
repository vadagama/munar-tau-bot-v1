import { REPORT_COMMANDS } from "../../bot/reports.ts";
import { INITIATIVE_COMMANDS } from "../../bot/initiatives.ts";
import { POLL_COMMANDS } from "../../bot/polls.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { STAFF_REQUEST_COMMANDS } from "../../bot/staff-requests.ts";
import { DOCUMENT_COMMANDS } from "../../bot/documents.ts";
import { INCIDENT_COMMANDS } from "../../bot/incidents.ts";
import { REQUEST_COMMANDS } from "../../bot/requests.ts";
import { TASK_COMMANDS } from "../../bot/tasks.ts";
import { replyText, type InlineButton } from "../../bot/keyboard.ts";
// Операции эмуляции (пилот, HLD 10.8): только техадминистратор, только
// тестовые персоны (is_test). Эмулированный Actor собирается по персоне —
// права оценивает PDP, привилегированные действия и управление недоступны;
// каждый шаг пишется в журнал с реальным актором и эмулируемой персоной
// (AUD-01, buildAuditInput). Роли тестовым персонам назначает председатель
// через обычный маршрут назначений — эмуляция не расширяет полномочия
// техадминистратора и не имеет обходного контура (HLD §6, §9).

import { ApiError } from "../../errors/api.ts";
import type { DbExecutor, DbTransactionRunner } from "../../db/client.ts";
import { buildActorForProfile } from "../admin/actor-service.ts";
import type { AdminRepo, AssignmentListRecord } from "../admin/port.ts";
import { notifyRoleChange } from "../admin/staff-notice.ts";
import { buildAuditInput } from "../audit/entry.ts";
import type { AuditRepo } from "../audit/port.ts";
import { ScenarioRegistry } from "../../bot/registry.ts";
import type { Actor } from "../../pdp/types.ts";
import type { EmulationRepo, EmulationSessionRecord, TestPersonRecord } from "./port.ts";

/** Зависимости операций эмуляции. */
export interface EmulationServiceDeps {
  admin: AdminRepo;
  emulation: EmulationRepo;
  audit: AuditRepo;
  tx: DbTransactionRunner;
}

/**
 * Эффективный Actor запроса: если у техадминистратора открыт сеанс эмуляции —
 * Actor собирается по эмулируемой персоне с пометкой эмуляции. Устаревший
 * сеанс (персона удалена) закрывается, запрос идёт от техадминистратора.
 */
export async function resolveEffectiveActor(
  deps: Pick<EmulationServiceDeps, "admin" | "emulation">,
  exec: DbExecutor,
  techActor: Actor,
  now: Date,
): Promise<Actor> {
  const session = await deps.emulation.getActiveSessionByTechProfile(exec, techActor.profile.id);
  if (!session) {
    return techActor;
  }
  const emulatedProfile = await deps.admin.getProfile(exec, session.emulatedProfileId);
  if (!emulatedProfile) {
    await deps.emulation.endSession(exec, session.id, now);
    return techActor;
  }
  const emulatedActor = await buildActorForProfile(deps.admin, exec, emulatedProfile, now);
  emulatedActor.emulation = {
    sessionId: session.id,
    realPersonId: techActor.person.id,
    realProfileId: techActor.profile.id,
  };
  return emulatedActor;
}

/**
 * Создание тестовой персоны (is_test) с синтетическими telegram/телефоном.
 * Роль персоне выдаёт председатель через /v1/admin/assignments (PDP-guarded) —
 * здесь роль не назначается.
 */
export async function createTestPerson(
  deps: EmulationServiceDeps,
  actor: Actor,
  input: { fullName: string },
): Promise<TestPersonRecord> {
  const fullName = input.fullName.trim();
  if (fullName === "") {
    throw new ApiError("VALIDATION_FAILED", "Укажите имя тестовой персоны");
  }
  return deps.tx.transaction(async (exec) => {
    await lockAudience(exec);
    const record = await deps.emulation.createTestPerson(exec, { fullName });
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "emulation.person.create",
      entityType: "person",
      entityId: record.person.id,
      after: {
        id: record.person.id,
        full_name: record.person.fullName,
        is_test: true,
        telegram_user_id: record.profile.telegramUserId,
      },
    }));
    return record;
  });
}

/**
 * Старт эмуляции (HLD 10.8): цель — тестовый активный профиль, не свой.
 * Новый сеанс завершает прежний активный сеанс того же техадминистратора.
 */
export async function startEmulation(
  deps: EmulationServiceDeps,
  actor: Actor,
  input: { emulatedProfileId: string },
  now: Date,
): Promise<EmulationSessionRecord> {
  return deps.tx.transaction(async (exec) => {
    await lockAudience(exec);
    const target = await deps.admin.getProfile(exec, input.emulatedProfileId);
    if (!target) {
      throw new ApiError("NOT_FOUND", "Профиль не найден");
    }
    if (target.id === actor.profile.id) {
      throw new ApiError("VALIDATION_FAILED", "Нельзя эмулировать собственный профиль");
    }
    if (target.archivedAt !== null) {
      throw new ApiError("VALIDATION_FAILED", "Профиль архивен");
    }
    if (!target.isTest) {
      throw new ApiError("FORBIDDEN", "Эмуляция доступна только для тестовых персон (HLD 10.8)");
    }

    const previous = await deps.emulation.getActiveSessionByTechProfile(exec, actor.profile.id);
    if (previous) {
      await deps.emulation.endSession(exec, previous.id, now);
    }
    const session = await deps.emulation.startSession(
      exec,
      { techAdminProfileId: actor.profile.id, emulatedProfileId: target.id },
      now,
    );
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "emulation.session.start",
      entityType: "emulation_session",
      entityId: session.id,
      after: {
        tech_admin_profile_id: session.techAdminProfileId,
        emulated_profile_id: session.emulatedProfileId,
      },
    }));
    return session;
  });
}

/**
 * Снятие роли с тестовой персоны (управление пилотом эмуляции, HLD 10.8):
 * только реальный техадмин вне эмуляции и только для is_test-персоны.
 * Действие повторяет отзыв назначения (ROL-03/04): при сокращении набора
 * ролей закрываются сеансы персоны, ставится уведомление об изменении
 * полномочий (для тестовой персоны — в канал симулятора), пишется аудит.
 * Выдача ролей остаётся у председателя через обычный маршрут назначений.
 */
export async function revokeTestPersonRole(
  deps: EmulationServiceDeps,
  actor: Actor,
  assignmentId: string,
  reason: string,
): Promise<AssignmentListRecord> {
  const trimmed = reason.trim();
  if (trimmed === "") {
    throw new ApiError("VALIDATION_FAILED", "Укажите причину снятия роли");
  }
  if (actor.emulation) {
    throw new ApiError("FORBIDDEN", "Управление ролями недоступно в эмуляции");
  }
  return deps.tx.transaction(async (exec) => {
    await lockAudience(exec);
    const assignment = await deps.admin.getAssignment(exec, assignmentId);
    if (!assignment) {
      throw new ApiError("NOT_FOUND", "Назначение не найдено");
    }
    if (assignment.status !== "active") {
      throw new ApiError("INVALID_TRANSITION", "Назначение уже отозвано");
    }
    const person = await deps.admin.getPerson(exec, assignment.personId);
    if (!person) {
      throw new ApiError("NOT_FOUND", "Персона не найдена");
    }
    if (!person.isTest) {
      throw new ApiError("FORBIDDEN", "Роли удаляются только у тестовых персон");
    }
    if (person.status !== "active") {
      throw new ApiError("INVALID_TRANSITION", "Персона не активна");
    }
    const activeRoles = async () =>
      [...new Set(
        (await deps.admin.listAssignments(exec, {
          personId: assignment.personId,
          activeOnly: true,
          limit: 500,
        })).map((row) => row.role),
      )];
    const before = await activeRoles();
    const revoked = await deps.admin.revokeAssignment(exec, assignmentId, actor.person.id);
    if (!revoked) {
      throw new ApiError("INVALID_TRANSITION", "Назначение уже отозвано");
    }
    const after = await activeRoles();
    if (after.length < before.length) {
      await deps.admin.revokeSessionsForPerson(exec, assignment.personId, trimmed, new Date());
    }
    await notifyRoleChange(
      exec,
      actor,
      assignment.personId,
      before,
      after,
      trimmed,
      `emulation:${assignmentId}:revoke`,
      person.isTest,
    );
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "emulation.person.role.revoke",
      entityType: "staff_assignment",
      entityId: assignmentId,
      before: { roles: before },
      after: { roles: after },
      reason: trimmed,
      buildingIds: assignment.scopeBuildingIds,
    }));
    const updated = await deps.admin.getAssignment(exec, assignmentId);
    if (!updated) {
      throw new ApiError("INTERNAL", "Назначение не найдено после отзыва");
    }
    return updated;
  });
}

/** Завершение сеанса эмуляции: свой активный сеанс; чужой не раскрываем. */
export async function endEmulation(
  deps: EmulationServiceDeps,
  actor: Actor,
  sessionId: string,
  now: Date,
): Promise<EmulationSessionRecord> {
  return deps.tx.transaction(async (exec) => {
    await lockAudience(exec);
    const session = await deps.emulation.getSession(exec, sessionId);
    if (!session || session.techAdminProfileId !== actor.profile.id) {
      throw new ApiError("NOT_FOUND", "Сеанс эмуляции не найден");
    }
    const ended = await deps.emulation.endSession(exec, sessionId, now);
    if (!ended) {
      throw new ApiError("INVALID_TRANSITION", "Сеанс эмуляции уже завершён");
    }
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "emulation.session.end",
      entityType: "emulation_session",
      entityId: sessionId,
      before: { state: "active" },
      after: { state: "ended" },
    }));
    return ended;
  });
}

export interface SimulateResult {
  bot?: "worker";
  scenarioId: string;
  reply: string;
  buttons?: InlineButton[][];
  menu?: (InlineButton & { scenario: string })[][];
}

/**
 * Шаг диалога симулятора (LLD-03 §3.16): исполняет тот же сценарный модуль,
 * что и бот. Доступен только в активном сеансе эмуляции — контекст сценария
 * получает эмулируемую персону.
 */
export async function simulate(
  deps: EmulationServiceDeps & { scenarios: ScenarioRegistry },
  actor: Actor,
  input: { scenarioId: string; text?: string; bot?: string },
): Promise<SimulateResult> {
  if (!actor.emulation) {
    throw new ApiError("VALIDATION_FAILED", "Симулятор доступен только в режиме эмуляции (HLD 10.8)");
  }
  const selectedScenario = input.scenarioId.trim();
  if (!deps.scenarios.get(selectedScenario)) {
    throw new ApiError("NOT_FOUND", "Сценарий не найден");
  }
  // Как в Telegram: команда выбирает сценарий, обычный ответ продолжает
  // выбранный. Иначе /register на шаге выбора помещения съедается как номер.
  const command = (input.text ?? "").trim().split(/\s+/)[0] ?? "";
  if(input.bot && !['resident','worker'].includes(input.bot))throw new ApiError('VALIDATION_FAILED');
  const bot=['tasks','staff-requests'].includes(selectedScenario)?'worker':['registration','requests'].includes(selectedScenario)?'resident':input.bot==='worker'?'worker':'resident';
  const scenarioId = !command.startsWith("/") ? selectedScenario
    : REPORT_COMMANDS.includes(command) ? "reports"
    : INITIATIVE_COMMANDS.includes(command) || (command === "/start" && /(?:^|\s)(?:idea_|mod_)/.test(input.text ?? "")) ? "initiatives"
    : POLL_COMMANDS.includes(command) || (command === "/start" && /(?:^|\s)poll_/.test(input.text ?? "")) ? "polls"
    : DOCUMENT_COMMANDS.includes(command) || (command === "/start" && /(?:^|\s)doc_/.test(input.text ?? "")) ? "documents"
    : STAFF_REQUEST_COMMANDS.includes(command) || (command==="/start" && /(?:sreq_|stsk_)/.test(input.text??"")) ? "staff-requests"
    : bot==="worker" && TASK_COMMANDS.includes(command) ? "tasks"
    : REQUEST_COMMANDS.includes(command) && bot!=="worker" ? "requests"
    : INCIDENT_COMMANDS.includes(command) ? "incidents"
    : TASK_COMMANDS.includes(command) ? "tasks"
    : command === "/notifications" ? "notifications"
    : bot==="worker" ? "tasks"
    : "registration";
  const scenario = deps.scenarios.get(scenarioId);
  if (!scenario) {
    throw new ApiError("NOT_FOUND", "Сценарий не найден");
  }
  return deps.tx.transaction(async (exec) => {
    await lockAudience(exec);
    const reply = await scenario.run(input.text ?? "", {
      actor,
      bot,
      executor: exec,
      profileId: actor.profile.id,
      personId: actor.person.id,
      fullName: actor.person.fullName,
    });
    await deps.audit.append(exec, buildAuditInput(actor, {
      action: "emulation.simulate",
      entityType: "emulation_session",
      entityId: actor.emulation?.sessionId,
      meta: { scenario: scenarioId },
    }));
    return { scenarioId, ...(bot==='worker'?{bot}:{}), reply: replyText(reply), ...(typeof reply === "string" ? {} : { buttons: reply.buttons }) };
  });
}
