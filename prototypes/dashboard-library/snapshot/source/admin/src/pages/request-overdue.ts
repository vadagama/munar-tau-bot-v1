import { CLOSED_STATES } from "../../../core/src/domains/requests/fsm";

const timestamp = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const deadlineText = (value: number) => new Date(value).toLocaleString("ru-RU", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});
function durationText(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "менее 1 мин";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const rest = minutes % 60;
  return [days ? `${days} д` : "", hours ? `${hours} ч` : "", rest ? `${rest} мин` : ""].filter(Boolean).join(" ");
}

type CurrentDeadline = { kind: "first_response" | "execution"; at: number };

/** Только неисполненные обязательства; overdue_since хранит историю и здесь не используется. */
function currentDeadlines(row: Record<string, unknown>, now: number): CurrentDeadline[] {
  if (row.state === "draft" || CLOSED_STATES.includes(String(row.state))) return [];
  const deadlines: CurrentDeadline[] = [];
  const firstDue = timestamp(row.first_response_due_at);
  if (!row.first_response_at && firstDue !== undefined && firstDue < now) {
    deadlines.push({ kind: "first_response", at: firstDue });
  }
  const due = timestamp(row.due_at);
  if (row.state !== "awaiting_confirmation" && due !== undefined && due < now) {
    deadlines.push({ kind: "execution", at: due });
  }
  return deadlines;
}

export function requestOverdue(row: Record<string, unknown>, now = Date.now()): boolean {
  return currentDeadlines(row, now).length > 0;
}

/** Длительность текущей просрочки календарная; исходный срок уже рассчитан TIM. */
export function requestOverdueDetails(row: Record<string, unknown>, now = Date.now()): string[] {
  return currentDeadlines(row, now).map(deadline => {
    const delay = durationText(now - deadline.at);
    const date = deadlineText(deadline.at);
    return deadline.kind === "first_response"
      ? `Первый ответ просрочен на ${delay} (календарное время). Срок: ${date}. Ответ ещё не дан.`
      : `Срок выполнения просрочен на ${delay} (календарное время). Срок: ${date}.`;
  });
}
