import { beforeEach,expect,it,vi } from "vitest";
import { submitInitiative,transitionInitiative } from "./service.ts";
import { checkedInitiativeDecision } from "./planning.ts";
import { B1,B2,makeTestActor } from "../../testing/actors.ts";
vi.mock("./planning.ts",()=>({checkedInitiativeDecision:vi.fn(async()=>({id:"30000000-0000-4000-8000-000000000001",document_id:"doc",version:1,title:"Решение"}))}));
vi.mock("../tasks/assignees.ts",()=>({requireTaskAssignee:vi.fn(async()=>{})}));
vi.mock("./support-state.ts",()=>({persistInitiativeExclusions:vi.fn(async()=>{}),initiativeSupportState:vi.fn(async()=>({count:3,people:[],excluded:[]}))}));
import {fixture,person,id,body} from "./service.test-support.ts";
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
