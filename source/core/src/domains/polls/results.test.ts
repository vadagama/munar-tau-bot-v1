import { expect, it } from "vitest";
import { calculatePollResult } from "./results.ts";
const options=[{key:"yes",label:"Да"},{key:"no",label:"Нет"}];
const answer=(personId:string,optionKey="yes",answeredAt=10)=>({personId,optionKey,answeredAt,version:1});
const histories=new Map([["a",[{from:0,until:100}]],["b",[{from:0,until:15},{from:18,until:100}]],["c",[{from:0,until:30}]]]);
it("считает на срок окончания, не на время запоздалого jobs",()=>{
  const result=calculatePollResult(options,[answer("a"),answer("b"),answer("c","no")],histories,20);
  expect(result.summary).toEqual({participants_count:2,distribution:[{option_key:"yes",count:1},{option_key:"no",count:1}]});
  expect(result.participantIds).toEqual(["a","c"]);
  expect(result.excluded).toEqual([{personId:"b",version:1,lostAt:15}]);
  expect(JSON.stringify(result.summary)).not.toContain('"a"');
});
it("после восстановления учитывает только заново данный ответ",()=>{
  const result=calculatePollResult(options,[answer("b","yes",19)],histories,20);
  expect(result.summary.participants_count).toBe(1);
  expect(result.excluded).toEqual([]);
});
it("ответ на границе отклоняется; отзыв ровно на границе не меняет уже данный голос",()=>{
  const result=calculatePollResult(options,[answer("a","yes",20),answer("c")],new Map([["a",[{from:0,until:100}]],["c",[{from:0,until:20}]]]),20);
  expect(result.summary.participants_count).toBe(1);
  expect(result.summary.distribution).toEqual([{option_key:"yes",count:1},{option_key:"no",count:0}]);
});
it("отсутствие истории не создаёт право; неизвестный вариант и дубли человека отвергаются",()=>{
  expect(calculatePollResult(options,[answer("missing")],histories,20).summary.participants_count).toBe(0);
  expect(()=>calculatePollResult(options,[answer("a","invalid")],histories,20)).toThrow();
  expect(()=>calculatePollResult(options,[answer("a"),answer("a")],histories,20)).toThrow();
});
