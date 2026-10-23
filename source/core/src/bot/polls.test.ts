import { beforeEach, expect, it, vi } from "vitest";
import { pollStep } from "./polls.ts";
import { replyText, type BotReply } from "./keyboard.ts";
import { B1, makeTestActor } from "../testing/actors.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { answerPoll, getPoll } from "../domains/polls/service.ts";
import { getPollResults } from "../domains/polls/transitions.ts";
vi.mock("./registration.ts",()=>({actorForTelegram:vi.fn()}));
vi.mock("../domains/polls/service.ts",()=>({getPoll:vi.fn(),answerPoll:vi.fn()}));
vi.mock("../domains/polls/list.ts",()=>({listPolls:async()=>({items:[{id:"10000000-0000-4000-8000-000000000001",question:"<b>Встреча</b>"}],has_more:false})}));
vi.mock("../domains/polls/transitions.ts",()=>({getPollResults:vi.fn()}));
const card={id:"10000000-0000-4000-8000-000000000001",question:"<b>Встреча</b>",options:[{key:"stable_a",label:"Суббота"},{key:"stable_b",label:"Воскресенье"}],closes_at:"2026-11-01T10:00:00Z",state:"open",version:4,can_answer:true,can_results:false,deadline_passed:false,own_answer:null,cancel_reason:null};
const buttons=(reply:BotReply)=>typeof reply==="string"?[]:reply.buttons?.flat()??[];
function fixture(){
  let state:Row={},profile:unknown,context:unknown;
  const deps={bot:"resident",db:{query:async<T>(sql:string,params:unknown[]=[]):Promise<T[]>=>{
    if(sql.startsWith("insert into bot_dialog_channel")){
      if(profile!==params[1]||context!==params[3])state={};profile=params[1];context=params[3];
    }
    if(sql.startsWith("select state"))return [{state}] as T[];
    if(sql.startsWith("update bot_dialog_channel"))state=JSON.parse(String(params[1]));
    return [];
  }}} as RegistryDeps;
  return {deps,state:()=>state,setState:(next:Row)=>{state=next;}};
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(getPoll).mockResolvedValue(card as never);vi.mocked(answerPoll).mockResolvedValue({} as never);vi.mocked(getPollResults).mockResolvedValue({participants_count:2,distribution:[{option_key:"stable_a",count:1},{option_key:"stable_b",count:1}],as_of:card.closes_at,final:true});});
for(const lang of ["ru","kk"] as const)it(`кнопки ${lang}: информационный характер, личное изменение и экранирование`,async()=>{
  const s=fixture(),base=makeTestActor("executor",[B1]),actor={...base,profile:{...base.profile,language:lang}};
  const reply=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor);
  expect(replyText(reply)).toContain("&lt;b&gt;Встреча&lt;/b&gt;");
  expect(replyText(reply)).toContain(lang==="ru"?"не является решением собрания":"жиналыс шешімі");
  expect(replyText(reply)).not.toContain("Суббота");
  const choose=buttons(reply).find(b=>b.text==="Суббота")!;
  expect(choose).toBeDefined();
  expect(buttons(reply).every(b=>new TextEncoder().encode(b.data).length<=64)).toBe(true);
  vi.mocked(getPoll).mockResolvedValueOnce(card as never).mockResolvedValue({...card,own_answer:{option_key:"stable_a",version:1,included:true,answered_at:new Date()}} as never);
  const saved=await pollStep(s.deps,"123",choose.data,actor);
  expect(answerPoll).toHaveBeenCalledWith(s.deps,actor,"10000000-0000-4000-8000-000000000001",{option_key:"stable_a",expected_version:0},expect.any(String));
  expect(replyText(saved)).toContain("Суббота");
  const change=buttons(saved).find(b=>b.text==="Воскресенье")!;
  await pollStep(s.deps,"123",change.data,actor);
  expect(answerPoll).toHaveBeenLastCalledWith(s.deps,actor,"10000000-0000-4000-8000-000000000001",{option_key:"stable_b",expected_version:1},expect.any(String));
  await expect(pollStep(s.deps,"123",choose.data,actor)).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
});
it("навигация, другая персона и новый сеанс инвалидируют кнопки",async()=>{
  const s=fixture(),actor=makeTestActor("executor",[B1]);
  const reply=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor),choose=buttons(reply).find(b=>b.text==="Суббота")!;
  await pollStep(s.deps,"123","/polls",actor);
  await expect(pollStep(s.deps,"123",choose.data,actor)).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  const next=buttons(await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor)).find(b=>b.text==="Суббота")!;
  await expect(pollStep(s.deps,"123",next.data,{...actor,profile:{...actor.profile,id:"other"}})).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  expect(answerPoll).not.toHaveBeenCalled();
});
it("утрата связи и чужая версия повторно проверяются до записи",async()=>{
  const s=fixture(),actor=makeTestActor("executor",[B1]),reply=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor),choose=buttons(reply).find(b=>b.text==="Суббота")!;
  vi.mocked(getPoll).mockResolvedValue({...card,can_answer:false} as never);
  await expect(pollStep(s.deps,"123",choose.data,actor)).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(answerPoll).not.toHaveBeenCalled();
});
it("исключение объясняется без автоматического восстановления; новый ответ использует личную версию",async()=>{
  vi.mocked(getPoll).mockResolvedValue({...card,own_answer:{option_key:"stable_a",version:3,included:false}} as never);
  const s=fixture(),actor=makeTestActor("executor",[B1]),reply=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor);
  expect(replyText(reply)).toContain("исключён");
  expect(replyText(reply)).not.toContain("Ваш ответ: Суббота");
  await pollStep(s.deps,"123",buttons(reply).find(b=>b.text==="Воскресенье")!.data,actor);
  expect(answerPoll).toHaveBeenCalledWith(s.deps,actor,"10000000-0000-4000-8000-000000000001",{option_key:"stable_b",expected_version:3},expect.any(String));
});
it("отмена скрывает результаты даже при флаге; закрытый итог содержит только распределение",async()=>{
  const s=fixture(),actor=makeTestActor("executor",[B1]);
  vi.mocked(getPoll).mockResolvedValue({...card,state:"canceled",can_results:true,can_answer:false,cancel_reason:"<b>Уточнение</b>"} as never);
  const canceled=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor);
  expect(replyText(canceled)).toContain("&lt;b&gt;Уточнение&lt;/b&gt;");expect(getPollResults).not.toHaveBeenCalled();
  vi.mocked(getPoll).mockResolvedValue({...card,state:"closed",can_results:true,can_answer:false} as never);
  expect(replyText(await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor))).toContain("Суббота: 1");
  expect(getPollResults).toHaveBeenCalledWith(s.deps,actor,"10000000-0000-4000-8000-000000000001");
});
it("бот сотрудника не принимает личный ответ даже при совмещении",async()=>{
  const s=fixture();s.deps.bot="worker";
  const reply=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",makeTestActor("chairman",[B1]));
  expect(buttons(reply).some(b=>b.data.startsWith("/pc "))).toBe(false);
  expect(answerPoll).not.toHaveBeenCalled();
});
it.each(["/poll xxx","/start poll_xxx"])("неверная ссылка %s отклоняется до SQL",async input=>{
  const s=fixture();
  await expect(pollStep(s.deps,"123",input,makeTestActor("executor",[B1]))).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  expect(getPoll).not.toHaveBeenCalled();expect(answerPoll).not.toHaveBeenCalled();
});

it("длинные варианты доступны целиком до записи и требуют подтверждения выбранного варианта",async()=>{
  const prefix="А".repeat(80),options=[{key:"stable_a",label:prefix+" первый"},{key:"stable_b",label:prefix+" второй"}];
  vi.mocked(getPoll).mockResolvedValue({...card,options} as never);
  const s=fixture(),actor=makeTestActor("executor",[B1]),reply=await pollStep(s.deps,"123","/poll 10000000-0000-4000-8000-000000000001",actor);
  const choices=buttons(reply).filter(b=>b.data.startsWith("/po "));
  expect(choices).toHaveLength(2);expect(choices[0]!.text).not.toBe(choices[1]!.text);
  const preview=await pollStep(s.deps,"123",choices[0]!.data,actor);
  expect(replyText(preview)).toContain(options[0]!.label);expect(answerPoll).not.toHaveBeenCalled();
  const confirm=buttons(preview).find(b=>b.data.startsWith("/pc "))!;
  await pollStep(s.deps,"123",choices[1]!.data,actor);
  await expect(pollStep(s.deps,"123",confirm.data,actor)).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
});
