import { invalid } from "../registry/validation.ts";

/** Первый момент после включительной даты периода; смещение берётся из IANA TZ. */
export function financialPeriodStart(periodTo: string) {
  const value = Date.parse(periodTo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodTo) || !Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== periodTo) invalid("Укажите действительную дату периода");
  const target = value + 86_400_000;
  const formatter = new Intl.DateTimeFormat("en", { timeZone: "Asia/Almaty", timeZoneName: "longOffset" });
  function offsetAt(instant: number) {
    const name = formatter.formatToParts(new Date(instant)).find(p => p.type === "timeZoneName")?.value;
    const offset = name?.match(/^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!offset) invalid("Не удалось определить время окончания периода");
    return (Number(offset[2]) * 3600 + Number(offset[3]) * 60 + Number(offset[4] ?? 0)) * (offset[1] === "+" ? 1000 : -1000);
  }
  // Проверяем оба смещения около перехода. При повторе полуночи берём первое
  // вхождение; несуществующую полночь не подменяем другим временем молча.
  const offsets = [...new Set([-86_400_000, 0, 86_400_000].map(delta => offsetAt(target + delta)))];
  const candidates = offsets.map(offset => target - offset).filter(instant => instant + offsetAt(instant) === target);
  if (!candidates.length) invalid("Для границы периода нет локального времени 00:00; уточните период");
  return new Date(Math.min(...candidates));
}

/** Только записи подтверждений из financial_placement, а не из outbox. */
export function missingFinancialPlacements(channels: string[], versionId: string,
  placements: { financial_version_id: string; channel: string }[]) {
  return channels.filter(channel => !placements.some(p => p.financial_version_id === versionId && p.channel === channel));
}
