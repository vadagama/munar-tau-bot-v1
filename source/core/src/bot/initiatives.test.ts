import { beforeEach,expect,it,vi } from "vitest";
import { botScenarios } from "./scenarios.ts";
import { initiativeStep } from "./initiatives.ts";
import { getInitiative,listInitiatives,initiativeSubmissionOptions,getModerationAction,listModerationActions } from "../domains/initiatives/queries.ts";
import { submitInitiative } from "../domains/initiatives/service.ts";
import { setInitiativeSupport } from "../domains/initiatives/support.ts";
import { addInitiativeComment } from "../domains/initiatives/comments.ts";
import { appealModerationAction } from "../domains/initiatives/moderation.ts";
import { B1,makeTestActor } from "../testing/actors.ts";
import { replyText,type BotReply } from "./keyboard.ts";
import type { Row } from "../domains/registry/validation.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
vi.mock("./registration.ts",async original=>({...await original<typeof import("./registration.ts")>(),actorForTelegram:vi.fn()}));
vi.mock("../domains/initiatives/queries.ts",()=>({getInitiative:vi.fn(),listInitiatives:vi.fn(),initiativeSubmissionOptions:vi.fn(),getModerationAction:vi.fn(),listModerationActions:vi.fn()}));
vi.mock("../domains/initiatives/service.ts",()=>({submitInitiative:vi.fn()}));
vi.mock("../domains/initiatives/support.ts",()=>({setInitiativeSupport:vi.fn()}));
vi.mock("../domains/initiatives/comments.ts",()=>({addInitiativeComment:vi.fn(),listInitiativeComments:vi.fn(async()=>({items:[],has_more:false})),readInitiativeComment:vi.fn()}));
vi.mock("../domains/initiatives/moderation.ts",()=>({appealModerationAction:vi.fn()}));
const id="10000000-0000-4000-8000-000000000001",actionId="40000000-0000-4000-8000-000000000001";
const card={id,title:"<b>Освещение</b>",body:"Двор",location_text:"У подъезда",publication_state:"published",stage:"collecting",version:2,can_comment:true,can_support:true,support_count:3,own_support:{version:1,supported:false},stage_reason:null,review_reason:null};
const buttons=(r:BotReply)=>typeof r==="string"?[]:r.buttons?.flat()??[];
function fixture(){let state:Row={},profile:unknown,context:unknown;const deps={bot:"resident",db:{query:async<T>(sql:string,p:unknown[]=[]):Promise<T[]>=>{
 if(sql.startsWith("select telegram_user_id from profile"))return [{telegram_user_id:"123"}] as T[];
 if(sql.startsWith("insert into bot_dialog_channel")){if(profile!==p[1]||context!==p[3])state={};profile=p[1];context=p[3];}
 if(sql.startsWith("select state"))return [{state}] as T[];if(sql.startsWith("update bot_dialog_channel"))state=JSON.parse(String(p[1]));return [];
 }}} as RegistryDeps;return {deps,state:()=>state};}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(getInitiative).mockResolvedValue(card as never);vi.mocked(listInitiatives).mockResolvedValue({items:[card],has_more:false} as never);vi.mocked(initiativeSubmissionOptions).mockResolvedValue([{id:B1,label:"Дом 1"}]);vi.mocked(submitInitiative).mockResolvedValue({id} as never);vi.mocked(getModerationAction).mockResolvedValue({id:actionId,kind:"restrict_author",version:3,reason:"Причина",until_at:"2026-10-25T10:00:00Z",decisions:[],can_appeal:true} as never);vi.mocked(listModerationActions).mockResolvedValue({items:[],has_more:false});});
for(const language of ["ru","kk"] as const)it(`инициатива ${language}: текст экранирован, поддержка личная, старые кнопки не действуют`,async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]);actor.profile.language=language;
 const reply=await initiativeStep(h.deps,"123",`/initiative ${id}`,actor);expect(replyText(reply)).toContain("&lt;b&gt;Освещение&lt;/b&gt;");
 const support=buttons(reply).find(b=>b.data.endsWith(" support"))!;expect(support).toBeDefined();
 await initiativeStep(h.deps,"123",support.data,actor);expect(setInitiativeSupport).toHaveBeenCalledWith(h.deps,actor,id,true,{expected_version:1},expect.any(String));
 await expect(initiativeStep(h.deps,"123",support.data,actor)).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
 expect(buttons(reply).every(b=>new TextEncoder().encode(b.data).length<=64)).toBe(true);
});
it("подача спрашивает текст и свои дома, до подтверждения не создаётся; кнопки не дублируются в теле",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]);await initiativeStep(h.deps,"123","/inew",actor);
 await initiativeStep(h.deps,"123","Освещение",actor);await initiativeStep(h.deps,"123","Нужно освещение",actor);
 const houses=await initiativeStep(h.deps,"123","Двор",actor);expect(replyText(houses)).not.toContain("Дом 1");
 const selected=await initiativeStep(h.deps,"123",buttons(houses).find(b=>b.data.includes(" h "))!.data,actor);
 const preview=await initiativeStep(h.deps,"123",buttons(selected).find(b=>b.data.endsWith(" review"))!.data,actor);expect(submitInitiative).not.toHaveBeenCalled();
 await initiativeStep(h.deps,"123",buttons(preview).find(b=>b.data.endsWith(" submit"))!.data,actor);
 expect(submitInitiative).toHaveBeenCalledWith(h.deps,actor,{title:"Освещение",body:"Нужно освещение",location_text:"Двор",building_ids:[B1]},expect.any(String));
});
it("комментарий подтверждается отдельно и повторяет версию/доступ перед записью",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]),reply=await initiativeStep(h.deps,"123",`/initiative ${id}`,actor);
 await initiativeStep(h.deps,"123",buttons(reply).find(b=>b.data.endsWith(" comment"))!.data,actor);
 const preview=await initiativeStep(h.deps,"123","<b>Комментарий</b>",actor);expect(replyText(preview)).toContain("&lt;b&gt;Комментарий&lt;/b&gt;");expect(addInitiativeComment).not.toHaveBeenCalled();
 const confirm=buttons(preview).find(b=>b.data.endsWith(" commentconfirm"))!.data;
 vi.mocked(getInitiative).mockResolvedValue({...card,can_comment:false} as never);
 await expect(initiativeStep(h.deps,"123",confirm,actor)).rejects.toMatchObject({code:"NOT_FOUND"});expect(addInitiativeComment).not.toHaveBeenCalled();
});
it("оспаривание привязано к конкретному действию и его версии; работник не пишет от жителя",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]),reply=await initiativeStep(h.deps,"123",`/im ${actionId}`,actor);
 await initiativeStep(h.deps,"123",buttons(reply).find(b=>b.data.endsWith(" appeal"))!.data,actor);
 const preview=await initiativeStep(h.deps,"123","Прошу проверить",actor);
 await initiativeStep(h.deps,"123",buttons(preview).find(b=>b.data.endsWith(" appealconfirm"))!.data,actor);
 expect(appealModerationAction).toHaveBeenCalledWith(h.deps,actor,actionId,{reason:"Прошу проверить",expected_version:3},expect.any(String));
 h.deps.bot="worker";await expect(initiativeStep(h.deps,"123","/inew",actor)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("навигация и смена персоны/сеанса закрывают формы, чужой nonce отклоняется",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]),reply=await initiativeStep(h.deps,"123",`/initiative ${id}`,actor),old=buttons(reply).find(b=>b.data.endsWith(" support"))!.data;
 await initiativeStep(h.deps,"123","/initiatives",actor);await expect(initiativeStep(h.deps,"123",old,actor)).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
 const next=buttons(await initiativeStep(h.deps,"123",`/initiative ${id}`,actor)).find(b=>b.data.endsWith(" support"))!.data;
 await expect(initiativeStep(h.deps,"123",next,{...actor,profile:{...actor.profile,id:"other"}})).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
 expect(setInitiativeSupport).not.toHaveBeenCalled();
});

it("новый сеанс инвалидирует старую кнопку; worker не поддерживает от лица жителя",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]);actor.emulation={sessionId:"old",realPersonId:"real",realProfileId:"real-profile"};
 const reply=await initiativeStep(h.deps,"123",`/initiative ${id}`,actor),old=buttons(reply).find(b=>b.data.endsWith(" support"))!.data;
 await expect(initiativeStep(h.deps,"123",old,{...actor,emulation:{...actor.emulation,sessionId:"new"}})).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
 h.deps.bot="worker";const readonly=await initiativeStep(h.deps,"123",`/initiative ${id}`,actor);
 expect(buttons(readonly).some(b=>b.data.startsWith("/ia "))).toBe(false);expect(setInitiativeSupport).not.toHaveBeenCalled();
});
it("медиа не заменяет текст формы; возврат сохраняет черновик и точное подтверждение",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]);await initiativeStep(h.deps,"123","/inew",actor);const media=await initiativeStep(h.deps,"123","",actor);
 expect(h.state().idea_step).toBe("title");await initiativeStep(h.deps,"123",buttons(media).find(b=>b.data.endsWith(" resume"))!.data,actor);
 await initiativeStep(h.deps,"123","Название",actor);await initiativeStep(h.deps,"123","Описание",actor);const houses=await initiativeStep(h.deps,"123","Место",actor);
 const selected=await initiativeStep(h.deps,"123",buttons(houses).find(b=>b.data.includes(" h "))!.data,actor);const preview=await initiativeStep(h.deps,"123",buttons(selected).find(b=>b.data.endsWith(" review"))!.data,actor);
 const fallback=await initiativeStep(h.deps,"123","",actor),resumed=await initiativeStep(h.deps,"123",buttons(fallback).find(b=>b.data.endsWith(" resume"))!.data,actor);
 expect(replyText(resumed)).toBe(replyText(preview));expect(submitInitiative).not.toHaveBeenCalled();
});
it("пустой выбор дома и неверная кнопка не создают инициативу",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1]);await initiativeStep(h.deps,"123","/inew",actor);await initiativeStep(h.deps,"123","Название",actor);await initiativeStep(h.deps,"123","Описание",actor);const houses=await initiativeStep(h.deps,"123","Место",actor);
 await expect(initiativeStep(h.deps,"123",buttons(houses).find(b=>b.data.endsWith(" review"))!.data,actor)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(initiativeStep(h.deps,"123",`/ia ${h.state().idea_token} h 99`,actor)).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(submitInitiative).not.toHaveBeenCalled();
});

it("симулятор запускает тот же сценарий с тестовой персоной и точными кнопками",async()=>{
 const h=fixture(),actor=makeTestActor("executor",[B1],{isTest:true});actor.emulation={sessionId:"session",realPersonId:"real",realProfileId:"real-profile"};
 const scenario=botScenarios(h.deps).get("initiatives")!;expect(scenario).toBeDefined();
 const reply=await scenario.run(`/initiative ${id}`,{actor,profileId:actor.profile.id,personId:actor.person.id,fullName:actor.person.fullName,bot:"resident"});
 expect(replyText(reply)).toContain("&lt;b&gt;Освещение&lt;/b&gt;");expect(buttons(reply).some(b=>b.data.endsWith(" support"))).toBe(true);
});
