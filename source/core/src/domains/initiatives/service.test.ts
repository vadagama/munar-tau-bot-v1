import { beforeEach,expect,it,vi } from "vitest";
import { submitInitiative,transitionInitiative } from "./service.ts";
import { checkedInitiativeDecision } from "./planning.ts";
import { B1,B2,makeTestActor } from "../../testing/actors.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { DbClient,DbExecutor } from "../../db/client.ts";
import type { InitiativeRow } from "./types.ts";
vi.mock("./planning.ts",()=>({checkedInitiativeDecision:vi.fn(async()=>({id:"30000000-0000-4000-8000-000000000001",document_id:"doc",version:1,title:"Решение"}))}));
vi.mock("../tasks/assignees.ts",()=>({requireTaskAssignee:vi.fn(async()=>{})}));
vi.mock("./support-state.ts",()=>({initiativeSupportState:vi.fn(async()=>({count:3,people:[],excluded:[]}))}));
const person="20000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000001";
const body={title:"Встреча",body:"Обсуждение двора",location_text:"Двор",building_ids:[B1]};
function fixture(){
  const s:{row:InitiativeRow|null;members:string[];audit:string[];keys:Map<string,unknown>;logs:unknown[][]}={row:null,members:[B1],audit:[],keys:new Map(),logs:[]};
  const exec:DbExecutor={async query<T>(sql:string,params:readonly unknown[]=[]):Promise<T[]>{
    let rows:unknown[]=[];
    if(sql.startsWith("select public.audience_clock") || sql.startsWith("select pg_advisory"))rows=[];
    else if(sql.startsWith("with initiative_clock"))rows=[{at:new Date(),at_text:new Date().toISOString(),us:String(Date.now()*1000),building_ids:s.members,active:true,restricted:false}];
    else if(sql.startsWith("select request_hash,response"))rows=s.keys.has(String(params[0]))?[s.keys.get(String(params[0]))]:[];
    else if(sql.startsWith("insert into idempotency_key"))s.keys.set(String(params[0]),{request_hash:params[2],response:JSON.parse(String(params[3]))});
    else if(sql.startsWith("select * from initiative where"))rows=s.row?[structuredClone(s.row)]:[];
    else if(sql.startsWith("select id from building"))rows=[{id:B1},{id:B2}];
    else if(sql.startsWith("insert into initiative(")){
      s.row={id,author_person_id:params[0],title:params[1],body:params[2],location_text:params[3],requested_building_ids:params[4],approved_building_ids:[],is_test:false,
        version:1,publication_state:"submitted",stage:null,review_reason:null,stage_reason:null,plan_basis:null,owner_decision_required:false,
        responsible_person_id:null,decision_document_version_id:null,decision_snapshot:null,estimated_due_at:null,created_at:new Date(),published_at:null,completed_at:null,support_closed_at:null,final_support_count:null} as InitiativeRow;
      rows=[structuredClone(s.row)];
    }else if(sql.startsWith("update initiative set")){
      const patch=JSON.parse(String(params[1]));s.row={...s.row,...patch,version:Number(s.row!.version)+1} as InitiativeRow;rows=[structuredClone(s.row)];
    }else if(sql.startsWith("insert into initiative_log"))s.logs.push([...params]);
    else if(sql.startsWith("insert into initiative_support_log") || sql.startsWith("update initiative_support"))rows=[];
    else throw new Error(`Unexpected SQL: ${sql}`);
    return rows as T[];
  }};
  const db:DbClient={...exec,close:async()=>{},transaction:async fn=>{
    const old=structuredClone(s);try{return await fn(exec);}catch(e){Object.assign(s,old);throw e;}
  }};
  const deps:RegistryDeps={db,audit:{async append(_exec,a){s.audit.push(a.action);return {...a,id:1,at:new Date().toISOString()};},async list(){throw new Error("unused");}}};
  const actor=makeTestActor("administrator",[B1],{personId:person});
  return {s,deps,actor,submit:()=>submitInitiative(deps,actor,body,"submit")};
}
beforeEach(()=>vi.clearAllMocks());
it("подача не выбирает чужие дома; повтор не создаёт дубль",async()=>{
  const h=fixture();await expect(submitInitiative(h.deps,h.actor,{...body,building_ids:[B2]},"bad")).rejects.toMatchObject({code:"FORBIDDEN"});
  await h.submit();await h.submit();expect(h.s.row!.version).toBe(1);expect(h.s.logs).toHaveLength(1);
});
it("публикация повторяет аудиторию автора; администратор не расширяет её даже с общей служебной областью",async()=>{
  const h=fixture();await h.submit();h.s.members=[];
  await expect(transitionInitiative(h.deps,h.actor,id,"publish",{expected_version:1,reason:"Проверено",building_ids:[B1]},"publish")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  h.s.members=[B1];h.actor.globalStaff=true;
  await expect(transitionInitiative(h.deps,h.actor,id,"publish",{expected_version:1,reason:"Расширение",building_ids:[B1,B2]},"expand")).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(h.s.row!.publication_state).toBe("submitted");
});
it("полный путь фиксирует проверенный документ и итог поддержки; пропуск и stale версия запрещены",async()=>{
  const h=fixture();await h.submit();
  await transitionInitiative(h.deps,h.actor,id,"publish",{expected_version:1,reason:"Проверено",building_ids:[B1],owner_decision_required:true},"publish");
  await expect(transitionInitiative(h.deps,h.actor,id,"implementing",{expected_version:2,reason:"Старт"},"skip")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  await transitionInitiative(h.deps,h.actor,id,"assessing",{expected_version:2,reason:"Оценка"},"assess");
  await expect(transitionInitiative(h.deps,h.actor,id,"planned",{expected_version:2,reason:"План"},"old")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  const plan={expected_version:3,reason:"План",basis:"Основание",responsible_person_id:person,estimated_due_at:"2026-11-01T10:00:00Z",decision_document_version_id:"30000000-0000-4000-8000-000000000001"};
  await transitionInitiative(h.deps,h.actor,id,"planned",plan,"plan");
  expect(checkedInitiativeDecision).toHaveBeenCalled();expect(h.s.row!.decision_snapshot).toMatchObject({title:"Решение",version:1});
  await transitionInitiative(h.deps,h.actor,id,"implementing",{expected_version:4,reason:"Старт"},"start");
  await transitionInitiative(h.deps,h.actor,id,"completed",{expected_version:5,reason:"Готово"},"finish");
  expect(h.s.row).toMatchObject({stage:"completed",final_support_count:3,version:6});
  expect(h.s.logs).toHaveLength(6);
});
it("отзыв проверки документа блокирует реализацию, не меняя сохранённый план",async()=>{
  const h=fixture();await h.submit();h.s.row={...h.s.row!,publication_state:"published",approved_building_ids:[B1],stage:"planned",version:4,
    owner_decision_required:true,decision_document_version_id:"30000000-0000-4000-8000-000000000001"};
  vi.mocked(checkedInitiativeDecision).mockRejectedValueOnce(Object.assign(new Error("Документ непригоден"),{code:"INVALID_TRANSITION"}));
  await expect(transitionInitiative(h.deps,h.actor,id,"implementing",{expected_version:4,reason:"Старт"},"start")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  expect(h.s.row!.stage).toBe("planned");
});

it("председатель расширяет на всё ОСИ, не подменяет выбранную аудиторию посторонним домом",async()=>{
  const h=fixture();await h.submit();const chairman=makeTestActor("chairman",[],{personId:person});
  await expect(transitionInitiative(h.deps,chairman,id,"publish",{expected_version:1,reason:"Другая аудитория",building_ids:[B2]},"replace")).rejects.toMatchObject({code:"FORBIDDEN"});
  await transitionInitiative(h.deps,chairman,id,"publish",{expected_version:1,reason:"Всё ОСИ",building_ids:[B1,B2]},"all");
  expect(h.s.row!.approved_building_ids).toEqual([B1,B2]);
});
