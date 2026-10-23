import { expect, it } from "vitest";
import { actor, harness, pollId, t } from "./poll.test-support.ts";
import { answerPoll } from "./service.ts";
import { closeDuePolls } from "./jobs.ts";
import { cancelPoll, getPollResults } from "./transitions.ts";
it("закрывает один раз по сроку; задержка jobs и последующие изменения не меняют итог",async()=>{
  const h=harness();await h.opened();await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  const closes=Number(h.s.poll!.closes_us);
  h.s.events.push({...h.s.events[0]!,id:"2",enabled:false,effective_at:String(closes+1)});
  h.s.now=closes+1000;
  expect(await closeDuePolls(h.deps)).toBe(1);
  expect(await closeDuePolls(h.deps)).toBe(0);
  const result=await getPollResults(h.deps,actor,pollId);
  expect(result.participants_count).toBe(1);
  expect(result.distribution).toEqual([{option_key:"private_sat",count:1},{option_key:"private_sun",count:0}]);
  expect(JSON.stringify(result)).not.toContain(actor.person.id);
  h.s.events=[];
  expect(await getPollResults(h.deps,actor,pollId)).toEqual(result);
});
it("не закрывает до срока и не выполняет порцию с истёкшим бюджетом",async()=>{
  const h=harness();await h.opened();
  expect(await closeDuePolls(h.deps)).toBe(0);
  expect(await closeDuePolls(h.deps,Date.now()-1)).toBe(0);
  expect(h.s.poll!.state).toBe("open");
});
it("отмена хранит причину и один раз уведомляет участников; распределение закрыто до чтения",async()=>{
  const h=harness();await h.opened();await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  const canceled=await cancelPoll(h.deps,actor,pollId,{expected_version:2,reason:"Вопрос уточняется"},"cancel");
  expect(canceled.cancel_reason).toBe("Вопрос уточняется");
  await cancelPoll(h.deps,actor,pollId,{expected_version:2,reason:"Вопрос уточняется"},"cancel");
  await expect(getPollResults(h.deps,actor,pollId)).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(h.s.notices).toHaveLength(1);expect(h.s.resultReads).toBe(0);
  expect(JSON.stringify(h.s.notices)).not.toContain("private_sat");
});
it("после срока отмена не подменяет завершение",async()=>{
  const h=harness();await h.opened();h.s.now=Number(h.s.poll!.closes_us);
  await expect(cancelPoll(h.deps,actor,pollId,{expected_version:2,reason:"Поздно"},"cancel")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.poll!.state).toBe("open");expect(h.s.now).toBeGreaterThan(t);
});

it("пересечение срока внутри транзакции отмены возвращает доменный отказ и откатывает записи",async()=>{
  const h=harness();await h.opened();h.s.cancelGuardError=true;
  await expect(cancelPoll(h.deps,actor,pollId,{expected_version:2,reason:"Поздняя отмена"},"race")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.poll!.state).toBe("open");expect(h.s.notices).toHaveLength(0);
});
