// Граница суток ассистента «05:00 → 05:00» Asia/Almaty (план S1.3, ADR-021).
// Алматы — UTC+5 без перехода на летнее время, поэтому 05:00 по Алматы —
// всегда ровно полночь UTC: границей дня служит номер суток с эпохи Unix.

const MS_PER_DAY = 86_400_000;

/** Номер ассистентских суток (дни с эпохи Unix) для момента now. */
export function assistantDay(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_DAY);
}

/**
 * Эффективная эпоха DO (план S1.3): max(эпоха из assistant_user_config,
 * сегодняшний день). Ручная очистка поднимает конфиг-эпоху выше сегодняшнего
 * дня (пересоздание DO), наступивший день 05:00 — сам становится новой эпохой.
 */
export function effectiveEpoch(configEpoch: number, now: Date): number {
  return Math.max(configEpoch, assistantDay(now));
}

/**
 * Момент, когда историю старой эпохи можно стирать (S6.1): следующая граница
 * суток (05:00 Алматы = полночь UTC) плюс retention суток хранения.
 * DO прошлой эпохи планирует на это время teardown-задачу Lifecycle.
 */
export function nextEpochBoundary(now: Date, retentionDays: number): number {
  return (assistantDay(now) + 1) * MS_PER_DAY + retentionDays * MS_PER_DAY;
}

/** Имя DO: один изолят на сотрудника и эпоху (план S1.1). */
export function assistantDoName(profileId: string, epoch: number): string {
  return `assistant:${profileId}:${epoch}`;
}

/** Разбор имени DO; null — имя не соответствует формату ассистента. */
export function parseAssistantDoName(name: string): { profileId: string; epoch: number } | null {
  const parts = name.split(":");
  if (parts.length !== 3 || parts[0] !== "assistant") return null;
  const profileId = parts[1];
  const epoch = Number(parts[2]);
  if (profileId === undefined || profileId === "" || !Number.isInteger(epoch) || epoch < 0) return null;
  return { profileId, epoch };
}
