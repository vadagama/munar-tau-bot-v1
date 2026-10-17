import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import { jsonValue } from "../registry/validation.ts";

export interface RuleContract {
  version: 1;
  key: string;
  start: string;
  calendar_pause: string;
  business_pause: string;
  finish: string;
  action: string;
  effect: string;
}
// Версия 1 неизменна: новая семантика требует нового каталога и совместимого обработчика.
const definitions: Record<string, [string, string, string, string]> = {
  emergency_primary: ["Направление сигнала основному дежурному", "Явное принятие или передача", "incident.reserve", "Передать резервному и уведомить администратора, не принимать автоматически"],
  emergency_reserve: ["Передача резервному дежурному", "Явное принятие или передача", "incident.administrator", "Передать администратору и уведомить председателя, не принимать автоматически"],
  incident_update_escalation: ["Пропуск обещанного обновления", "Публикация нового обновления или завершение", "incident.update_overdue", "Уведомить председателя, не завершать инцидент"],
  work_schedule: [
    "Начало отсчёта нового рабочего срока",
    "Окончание соответствующего срока",
    "calendar.apply",
    "Учитывать только рабочие интервалы; не менять бизнес-состояние",
  ],
  first_response: [
    "Регистрация обращения и присвоение номера",
    "Первый содержательный ответ сотрудника или завершение обращения",
    "request.first_response_overdue",
    "Сохранить просрочку и уведомить обработчиков",
  ],
  author_reminder: [
    "Передача конкретной версии результата автору",
    "Подтверждение, отзыв результата или доработка",
    "request.remind_author",
    "Напомнить автору без автоматического закрытия",
  ],
  request_admin_close_wait: [
    "Передача конкретной версии результата автору",
    "Подтверждение, отзыв результата или доработка",
    "request.check_confirmation",
    "Уведомить администратора о необходимости проверки; не закрывать автоматически",
  ],
  request_reopen: [
    "Закрытие обращения",
    "Истечение окна повторного открытия",
    "request.end_reopen_window",
    "Запретить повторное открытие после окна; сохранить историю",
  ],
  digest_time: [
    "Окончание текущей рабочей смены",
    "Обработка доступных публикаций за локальный день",
    "notification.digest",
    "Создать только непустую сводку с повторной проверкой доступа",
  ],
  invite_expiry: [
    "Создание приглашения",
    "Использование, отмена или истечение приглашения",
    "registration.expire_invite",
    "Сделать неиспользованное приглашение недействительным",
  ],
  tenant_wait: [
    "Ожидание решения собственника",
    "Решение, отзыв или переход на следующий этап",
    "registration.escalate_owner",
    "Передать рассмотрение сотруднику без автоматического предоставления доступа",
  ],
  registration_stage: [
    "Поступление вопроса текущему ответственному",
    "Решение или передача следующему ответственному",
    "registration.escalate_reviewer",
    "Передать заместителю/председателю без решения за человека",
  ],
  dispute_total: [
    "Открытие спора о доступе",
    "Разрешение или отмена спора",
    "registration.dispute_overdue",
    "Сохранить просрочку и уведомить; передача между сотрудниками срок не обнуляет",
  ],
  task_accept: [
    "Направление нового назначения исполнителю",
    "Принятие, отказ, снятие или отмена назначения",
    "task.acceptance_overdue",
    "Уведомить администратора; молчание не означает принятия",
  ],
  task_escalation: [
    "Истечение предыдущего этапа ожидания принятия",
    "Принятие, отказ, снятие или отмена назначения",
    "task.escalate_acceptance",
    "Последовательно уведомить заместителя и председателя без начала работ",
  ],
};
export function ruleContract(key: string, value: unknown = {}): RuleContract {
  const d = definitions[key];
  if (!d) {
    throw new ApiError("VALIDATION_FAILED", "Неизвестный контракт регламента");
  }
  const expected: RuleContract = {
    version: 1,
    key,
    start: d[0],
    calendar_pause:
      "Рабочий отсчёт приостанавливается вне графика и продолжается в следующую смену; календарный идёт непрерывно",
    business_pause:
      "Бизнес-пауза не разрешена этим правилом и не обнуляет срок",
    finish: d[1],
    action: d[2],
    effect: d[3],
  };
  const p = jsonValue<{ contract?: unknown; clock?: unknown }>(value ?? {});
  if(key.startsWith("emergency_") && p.clock!==undefined && p.clock!=="calendar") throw new ApiError("VALIDATION_FAILED","Аварийное дежурство действует круглосуточно");
  if (p.contract !== undefined) {
    const actual = p.contract as Record<string, unknown> | null;
    if (
      !actual || typeof actual !== "object" ||
      Object.keys(actual).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([k, v]) => actual[k] !== v)
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Неподдерживаемая версия или действие регламента",
      );
    }
  }
  return expected;
}
export function editableRuleParams(value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new ApiError("VALIDATION_FAILED");
  }
  const allowed = ["hours", "clock", "start", "end", "timezone", "days"];
  if (Object.keys(value).some((k) => !allowed.includes(k))) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Условия и действие регламента задаются сервером",
    );
  }
}
export async function checkTimerContract(
  exec: DbExecutor,
  versionId: string,
  key: string,
) {
  const [v] = await exec.query<{ key: string; params: unknown }>(
    "select r.key,v.params from time_rule_version v join time_rule r on r.id=v.rule_id where v.id=$1",
    [versionId],
  );
  if (!v || v.key !== key) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Регламент не соответствует обработчику",
    );
  }
  return ruleContract(key, v.params);
}
