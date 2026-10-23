import { expect,it } from "vitest";
import { fixture,id } from "./service.test-support.ts";
import { setInitiativeSupport } from "./support.ts";
import { B1 } from "../../testing/actors.ts";
async function published(){const h=fixture();await h.submit();Object.assign(h.s.row!,{publication_state:"published",approved_building_ids:[B1],stage:"collecting",version:2});return h;}
it("поддержка одна на человека, повтор без эффекта; явный отзыв и новое действие повышают личную версию",async()=>{
  const h=await published();
  expect(await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:0},"support")).toMatchObject({supported:true,version:1});
  await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:0},"support");
  expect(await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:1},"same")).toMatchObject({supported:true,version:1});
  expect(await setInitiativeSupport(h.deps,h.actor,id,false,{expected_version:1},"withdraw")).toMatchObject({supported:false,version:2});
  expect(await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:2},"again")).toMatchObject({supported:true,version:3});
});
it("утрата аудитории запрещает действие; после восстановления прежняя поддержка не возвращается автоматически",async()=>{
  const h=await published();await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:0},"support");
  h.s.members=[];
  await expect(setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:1},"lost")).rejects.toMatchObject({code:"NOT_FOUND"});
  h.s.members=[B1];h.s.events.push({...h.s.events[0]!,id:"2",enabled:false,effective_at:String(h.s.now+1000)},{...h.s.events[0]!,id:"3",effective_at:String(h.s.now+2000)});h.s.now+=3000;
  expect(await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:1},"rejoin")).toMatchObject({supported:true,version:2});
  expect(h.s.supportLogs.filter(log=>log[3]==="excluded")).toHaveLength(1);
});
it("чужая личность и устаревшая версия отклоняются; завершённый итог не меняется",async()=>{
  const h=await published();
  await expect(setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:0,person_id:"other"},"foreign")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:0},"support");
  await expect(setInitiativeSupport(h.deps,h.actor,id,false,{expected_version:0},"stale")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  h.s.row!.stage="completed";
  await expect(setInitiativeSupport(h.deps,h.actor,id,false,{expected_version:1},"late")).rejects.toMatchObject({code:"NOT_FOUND"});
});
