import { describe, expect, it } from "vitest";
import { audienceIntervals, audienceEligible, audienceContinuous, type AudienceEvent } from "./audience-history.ts";
const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`);
const event = (id: number, day: number, fields: Partial<AudienceEvent> = {}): AudienceEvent => ({ id, connectionId: "link-a", personId: "person", buildingId: "house", isTest: true, effectiveAt: at(day), enabled: true, validFrom: null, validUntil: null, ...fields });
const scope = { personId: "person", isTest: true, buildingIds: ["house"], startsAt: at(10) };
const intervals = (events: AudienceEvent[]) => audienceIntervals(events, scope);
describe("история аудитории POL-02", () => {
  it("не придумывает право до начала истории; отзыв действует на точной границе", () => {
    const result = intervals([event(1, 10), event(2, 15, { enabled: false })]);
    expect(audienceEligible(result, at(9))).toBe(false);
    expect(audienceEligible(result, at(10))).toBe(true);
    expect(audienceEligible(result, at(15))).toBe(false);
  });
  it("восстановление связи не восстанавливает прежний голос", () => {
    const result = intervals([event(1, 10), event(2, 12, { enabled: false }), event(3, 14)]);
    expect(audienceEligible(result, at(15))).toBe(true);
    expect(audienceContinuous(result, at(11), at(15))).toBe(false);
    expect(audienceContinuous(result, at(14), at(15))).toBe(true);
  });
  it("другая подходящая связь сохраняет непрерывность", () => {
    const result = intervals([event(1, 10), event(2, 11, { connectionId: "link-b" }), event(3, 12, { enabled: false })]);
    expect(audienceContinuous(result, at(10), at(20))).toBe(true);
  });
  it("срок действия прекращается без jobs: начало включительно, конец исключительно", () => {
    const result = intervals([event(1, 10, { validFrom: at(12), validUntil: at(15) })]);
    expect(audienceEligible(result, at(11))).toBe(false);
    expect(audienceEligible(result, at(12))).toBe(true);
    expect(audienceEligible(result, at(15))).toBe(false);
  });
  it("смена человека завершает старый интервал до фильтрации", () => {
    expect(audienceEligible(intervals([event(1, 10), event(2, 12, { personId: "other" })]), at(13))).toBe(false);
  });
  it("отделяет режим, дом и недействующий профиль", () => {
    for (const fields of [{ isTest: false }, { buildingId: "other" }, { enabled: false }]) {
      expect(audienceEligible(intervals([event(1, 10, fields)]), at(11))).toBe(false);
    }
  });
  it("атомарная замена состояния не создаёт искусственный разрыв", () => {
    expect(audienceContinuous(intervals([event(3, 12), event(1, 10), event(2, 12, { enabled: false })]), at(11), at(15))).toBe(true);
  });
  it("изменение после срока не меняет право на срок окончания", () => {
    const result = intervals([event(1, 10), event(2, 20, { enabled: false })]);
    expect(audienceContinuous(result, at(11), at(15))).toBe(true);
    expect(audienceContinuous(result, at(11), at(20))).toBe(false);
  });
  it("различает микросекунды PostgreSQL на границе закрытия", () => {
    const start=at(10).getTime()*1000, close=at(15).getTime()*1000+123;
    const result=intervals([event(1,10),event(2,15,{effectiveAt:close,enabled:false})]);
    expect(audienceContinuous(result,start,close-1)).toBe(true);
    expect(audienceContinuous(result,start,close)).toBe(false);
  });

});
