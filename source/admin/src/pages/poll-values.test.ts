import { expect,it } from "vitest";
import dayjs from "dayjs";
import { pollDraftBody,pollEditorValues } from "./poll-values";
import type { PollBase } from "./poll-types";
it("срок формы — местное время Алматы независимо от зоны браузера; ключи вариантов сохраняются",()=>{
  const values={question:"Встреча",options:[{key:"stable",label:"Да"},{key:"other",label:"Нет"}],building_ids:["house"],closes_at:dayjs("2026-11-01T15:30:00"),reason:"Согласуем"};
  expect(pollDraftBody(values,3)).toMatchObject({closes_at:"2026-11-01T10:30:00.000Z",expected_version:3,options:values.options});
  expect(pollEditorValues({closes_at:"2026-11-01T10:30:00Z",options:values.options,question:"Встреча",building_ids:["house"]} as PollBase).closes_at.format("HH:mm")).toBe("15:30");
});
it("нет произвольного срока и скрытые поля не отправляются",()=>{
  expect(()=>pollDraftBody({question:"Текст"})).toThrow();
  const result=pollDraftBody({question:"Текст",options:[],building_ids:[],closes_at:dayjs("2026-11-01T15:30:00"),reason:"Причина",state:"open",person_id:"foreign"});
  expect(result).not.toHaveProperty("person_id");expect(result).not.toHaveProperty("state");expect(result).not.toHaveProperty("expected_version");
});
