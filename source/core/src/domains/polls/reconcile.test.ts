import { expect, it } from "vitest";
import { harness, actor, pollId, t } from "./poll.test-support.ts";
import { answerPoll, getPoll } from "./service.ts";
import { reconcileOpenPolls } from "./reconcile.ts";
it("фон фиксирует исключение в открытом опросе без смены версии и раскрытия выбора",async()=>{
  const h=harness();await h.opened();await answerPoll(h.deps,actor,pollId,{option_key:"private_sat",expected_version:0},"vote");
  h.s.events.push({...h.s.events[0]!,id:"2",enabled:false,effective_at:String(t+1000)});h.s.now=t+2000;
  const version=h.s.poll!.version;
  expect(await reconcileOpenPolls(h.deps)).toBe(1);
  expect(h.s.poll!.version).toBe(version);expect(h.s.poll!.state).toBe("open");
  expect(h.s.logs.filter(l=>String(l.sql).includes("'excluded'"))).toHaveLength(1);
  expect(JSON.stringify(h.s.audit)).not.toContain("private_sat");expect(h.s.notices).toHaveLength(0);
  h.s.events.push({...h.s.events[0]!,id:"3",effective_at:String(t+3000)});h.s.now=t+4000;
  expect((await getPoll(h.deps,actor,pollId)).own_answer?.included).toBe(false);
});
it("не обрабатывает истёкший опрос или порцию без бюджета",async()=>{
  const h=harness();await h.opened();h.s.now=Number(h.s.poll!.closes_us);
  expect(await reconcileOpenPolls(h.deps)).toBe(0);
  expect(await reconcileOpenPolls(h.deps,Date.now()-1)).toBe(0);
  expect(h.s.poll!.state).toBe("open");
});
