import { expect,it } from "vitest";
import dayjs from "dayjs";
import { initiativeDeadline } from "./initiative-values";
it("ручной срок трактуется как Алматы даже в UTC-браузере",()=>{
 expect(initiativeDeadline(dayjs("2026-11-01T15:30:00"))).toBe("2026-11-01T10:30:00.000Z");
});
it("пустой или некорректный срок не сериализуется",()=>{
 expect(()=>initiativeDeadline(undefined)).toThrow();expect(()=>initiativeDeadline(dayjs("invalid"))).toThrow();
});
