// Даты системы — Алматы (HLD): все сроки рендерятся в одной таймзоне,
// независимо от таймзоны браузера сотрудника. Секунды не показываем.
export function formatDateTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}
