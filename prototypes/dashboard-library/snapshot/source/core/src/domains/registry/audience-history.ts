/** Снимки берутся из закрытой истории БД. Даты действия переводятся в
 * полуоткрытые интервалы сервером PostgreSQL в зоне Asia/Almaty. */
/** Число — целые микросекунды Unix из PostgreSQL, Date — точность тестовых часов. */
export type AudienceInstant = Date | number;
function micros(value: AudienceInstant): number {
  const result = value instanceof Date ? value.getTime() * 1000 : value;
  if (!Number.isSafeInteger(result)) throw new Error("Некорректная отметка истории аудитории");
  return result;
}
export interface AudienceEvent {
  id: number;
  connectionId: string;
  personId: string;
  buildingId: string;
  isTest: boolean;
  effectiveAt: AudienceInstant;
  enabled: boolean;
  validFrom: AudienceInstant | null;
  validUntil: AudienceInstant | null;
}
export interface AudienceInterval { from: number; until: number }
export interface AudienceScope {
  personId: string;
  isTest: boolean;
  buildingIds: readonly string[];
  startsAt: AudienceInstant;
}

/** Сначала восстанавливаем каждую связь целиком, затем отбираем человека:
 * иначе перенос связи оставил бы прежнему человеку бесконечное право. */
export function audienceIntervals(events: readonly AudienceEvent[], scope: AudienceScope): AudienceInterval[] {
  const links = new Map<string, AudienceEvent[]>();
  for (const event of events) {
    const group = links.get(event.connectionId) ?? [];
    group.push(event);
    links.set(event.connectionId, group);
  }
  const intervals: AudienceInterval[] = [];
  for (const group of links.values()) {
    group.sort((a, b) => micros(a.effectiveAt) - micros(b.effectiveAt) || a.id - b.id);
    for (let index = 0; index < group.length; index++) {
      const event = group[index];
      if (!event) continue;
      const next = group[index + 1];
      if (!event.enabled || event.personId !== scope.personId || event.isTest !== scope.isTest || !scope.buildingIds.includes(event.buildingId)) continue;
      const from = Math.max(micros(scope.startsAt), micros(event.effectiveAt), event.validFrom !== null ? micros(event.validFrom) : -Infinity);
      const until = Math.min(next ? micros(next.effectiveAt) : Infinity, event.validUntil !== null ? micros(event.validUntil) : Infinity);
      if (from < until) intervals.push({ from, until });
    }
  }
  intervals.sort((a, b) => a.from - b.from);
  const merged: AudienceInterval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.from <= last.until) last.until = Math.max(last.until, interval.until);
    else merged.push({ ...interval });
  }
  return merged;
}

export function audienceEligible(intervals: readonly AudienceInterval[], at: AudienceInstant): boolean {
  return intervals.some((interval) => interval.from <= micros(at) && micros(at) < interval.until);
}

/** Потеря последней связи исключает голос; восстановление требует нового ответа. */
export function audienceContinuous(intervals: readonly AudienceInterval[], answeredAt: AudienceInstant, at: AudienceInstant): boolean {
  return micros(answeredAt) <= micros(at) && intervals.some((interval) => interval.from <= micros(answeredAt) && micros(at) < interval.until);
}

/** Открытый период заканчивается перед closes_at. Отзыв ровно на границе
 * уже не относится к открытому периоду и не меняет ранее данный голос. */
export function audienceContinuousBefore(intervals:readonly AudienceInterval[],answeredAt:AudienceInstant,closesAt:AudienceInstant):boolean {
  return micros(answeredAt)<micros(closesAt) && intervals.some(interval=>interval.from<=micros(answeredAt) && micros(closesAt)<=interval.until);
}

/** Только серверный расчёт POL, не DTO кабинета или экспорта. Gate вызывается
 * владельцем транзакции до чтения/записи опроса (ADR-019). */
export async function loadAudienceBatch(
  exec: import("../../db/client.ts").DbExecutor,
  scope: Pick<AudienceScope,"isTest"|"buildingIds">,
  personIds: readonly string[],
): Promise<Map<string,AudienceInterval[]>> {
  if(!personIds.length)return new Map();
  const [meta] = await exec.query<{ starts_at: string }>("select (extract(epoch from starts_at)*1000000)::bigint as starts_at from audience_history_meta where singleton");
  if (!meta) throw new Error("История аудитории не инициализирована");
  const rows = await exec.query<{
    id: string; connection_id: string; person_id: string; building_id: string;
    is_test: boolean; enabled: boolean; effective_at: string; valid_from: string | null; valid_until: string | null;
  }>(`select e.id,e.connection_id,e.person_id,e.building_id,e.is_test,e.enabled,
    (extract(epoch from e.effective_at)*1000000)::bigint as effective_at,
    (extract(epoch from e.valid_from)*1000000)::bigint as valid_from,
    (extract(epoch from e.valid_until)*1000000)::bigint as valid_until
    from audience_connection_event e where e.connection_id in
    (select connection_id from audience_connection_event where person_id=any($1::uuid[]))
    order by e.connection_id,e.effective_at,e.id`, [personIds]);
  const events=rows.map(row => ({
    id: Number(row.id), connectionId: row.connection_id, personId: row.person_id,
    buildingId: row.building_id, isTest: row.is_test, enabled: row.enabled,
    effectiveAt: Number(row.effective_at), validFrom: row.valid_from === null ? null : Number(row.valid_from), validUntil: row.valid_until === null ? null : Number(row.valid_until),
  }));
  return new Map(personIds.map(personId=>[personId,audienceIntervals(events,{...scope,personId,startsAt:Number(meta.starts_at)})]));
}
export async function loadAudienceIntervals(
  exec: import("../../db/client.ts").DbExecutor,
  scope: Omit<AudienceScope, "startsAt">,
): Promise<AudienceInterval[]> {
  return (await loadAudienceBatch(exec,scope,[scope.personId])).get(scope.personId)??[];
}
