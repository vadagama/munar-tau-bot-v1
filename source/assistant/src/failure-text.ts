// Человекочитаемые описания сбоев ответа ассистента (решение владельца
// 26.10.2026): вместо сырой причины Pi (no_model и т.п.) панель показывает
// развёрнутый текст «что случилось и что делать». Модуль чистый;
// pi-runtime подставляет текст в reason не-done результатов wait().

/** Сырая причина от провайдера/Pi обрезается до этой длины. */
const REASON_MAX_LENGTH = 200;

const RETRY_HINT = "Нажмите «Повторить» под вопросом — попытка будет выполнена заново.";

export interface FailureDescriptionInput {
  /** Ключ провайдера получен (runtime-token выдан) — модель была доступна. */
  apiKeyPresent: boolean;
  /** Сырая причина сбоя от Pi/провайдера (например, no_model). */
  reason?: string | null;
}

function describeReason(reason: string | null): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed === "") return "";
  const detail = trimmed.length > REASON_MAX_LENGTH ? `${trimmed.slice(0, REASON_MAX_LENGTH)}…` : trimmed;
  return ` Причина: ${detail}.`;
}

/** Развёрнутый текст сбоя для панели: что случилось, причина и что делать. */
export function describeFailure({ apiKeyPresent, reason }: FailureDescriptionInput): string {
  if (!apiKeyPresent) {
    // Без ключа модели причина Pi (no_model) лишь следствие: пользователю
    // важна настройка доступа, а не внутренняя причина.
    return `Ассистент не получил доступ к модели, поэтому ответ не подготовлен. Проверьте настройки AI-ассистента: должен быть задан токен провайдера, а на сервере функций — секрет ASSISTANT_API_KEY_SECRET. После настройки ${RETRY_HINT.charAt(0).toLowerCase()}${RETRY_HINT.slice(1)}`;
  }
  return `Ассистент не смог подготовить ответ — модель завершила обработку с ошибкой.${describeReason(reason ?? null)} ${RETRY_HINT}`;
}
