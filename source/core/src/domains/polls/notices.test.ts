import { expect,it } from "vitest";
import { actor,harness,pollId } from "./poll.test-support.ts";
import { answerPoll } from "./service.ts";
import { cancelPoll } from "./transitions.ts";
import { closeDuePolls } from "./jobs.ts";
import { pollNoticeAllowed } from "./notices.ts";
it("выпущенное закрытие сохраняет доступ участнику снимка после переезда; старое приглашение уже не доставляется",async()=>{
  const h=harness();await h.opened();await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  h.s.now=Number(h.s.poll!.closes_us)+1000;
  await closeDuePolls(h.deps);h.s.events=[];
  expect(await pollNoticeAllowed(h.deps.db,actor,pollId,"closed")).toBe(true);
  expect(await pollNoticeAllowed(h.deps.db,actor,pollId,"opened")).toBe(false);
  h.s.participants=[];
  expect(await pollNoticeAllowed(h.deps.db,actor,pollId,"closed")).toBe(false);
});
it("отмена уведомляет прежнего участника, не роль управляющего или случайного жителя аудитории",async()=>{
  const h=harness();await h.opened();
  await cancelPoll(h.deps,actor,pollId,{expected_version:2,reason:"Уточнение"},"cancel");
  expect(await pollNoticeAllowed(h.deps.db,actor,pollId,"canceled")).toBe(false);
  h.s.answer={version:1,option_key:"private_sat",answered_us:"0"};
  h.s.events=[];
  expect(await pollNoticeAllowed(h.deps.db,actor,pollId,"canceled")).toBe(true);
  expect(await pollNoticeAllowed(h.deps.db,actor,pollId,"closed")).toBe(false);
});
