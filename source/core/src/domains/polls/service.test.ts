import { expect, it } from "vitest";
import { answerPoll, getPoll, openPoll, savePoll } from "./service.ts";
import { actor, body, harness, pollId, t } from "./poll.test-support.ts";
it("после открытия параметры неизменны; версия черновика защищает устаревшую форму",async()=>{
  const h=harness();await savePoll(h.deps,actor,null,body,"create");
  await expect(savePoll(h.deps,actor,pollId,{question:"Другое",reason:"Правка",expected_version:0},"old")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  await openPoll(h.deps,actor,pollId,{expected_version:1,reason:"Открываем"},"open");
  await expect(savePoll(h.deps,actor,pollId,{question:"Другое",reason:"Правка",expected_version:2},"edit")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.poll?.question).toBe(body.question);
});
it("изменяет один личный ответ, повтор ключа не создаёт новый; выбор не попадает в общий аудит",async()=>{
  const h=harness();await h.opened();
  const first=await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  expect(await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote")).toEqual(JSON.parse(JSON.stringify(first)));
  await expect(answerPoll(h.deps,actor,pollId,{option_key:"private_sun",expected_version:0},"oldvote")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  const updated=await answerPoll(h.deps,actor,pollId,{option_key:"private_sun",expected_version:1},"change");
  expect(updated.version).toBe(2);expect(h.s.logs).toHaveLength(2);
  expect(JSON.stringify(h.s.audit)).not.toContain("private_sat");expect(JSON.stringify(h.s.audit)).not.toContain("private_sun");
});
it("потеря и восстановление последней связи исключает прежний ответ, новый фиксирует повторное участие",async()=>{
  const h=harness();await h.opened();await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  const initial=h.s.events[0]!;
  h.s.events.push({...initial,id:"2",enabled:false,effective_at:String(t+1000)},{...initial,id:"3",effective_at:String(t+2000)});
  h.s.now=t+3000;
  expect((await getPoll(h.deps,actor,pollId)).own_answer?.included).toBe(false);
  await answerPoll(h.deps,actor,pollId,{option_key:"private_sun",expected_version:1},"rejoin");
  expect(h.s.logs.filter(row=>String(row.sql).includes("'excluded'"))).toHaveLength(1);
  expect((await getPoll(h.deps,actor,pollId)).own_answer?.included).toBe(true);
});
it("точно на сроке ответ закрыт без ожидания jobs",async()=>{
  const h=harness();await h.opened();h.s.now=Number(h.s.poll!.closes_us);
  await expect(answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"late")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.answer).toBeNull();
});
it("управляющий без действующей связи не голосует и не получает чужие персональные ответы",async()=>{
  const h=harness(false);await h.opened();
  await expect(answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote")).rejects.toMatchObject({code:"NOT_FOUND"});
  const card=await getPoll(h.deps,actor,pollId);expect(card.can_manage).toBe(true);expect(card.can_answer).toBe(false);expect(card.own_answer).toBeNull();
});
