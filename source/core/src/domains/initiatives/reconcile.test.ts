import { expect,it } from "vitest";
import { fixture,id } from "./service.test-support.ts";
import { B1 } from "../../testing/actors.ts";
import { setInitiativeSupport } from "./support.ts";
import { reconcileInitiativeSupport } from "./reconcile.ts";
it("фоновое исключение сохраняется без смены версии карточки и не восстанавливается после возврата связи",async()=>{
 const h=fixture();await h.submit();Object.assign(h.s.row!,{publication_state:"published",approved_building_ids:[B1],stage:"collecting",version:2});
 await setInitiativeSupport(h.deps,h.actor,id,true,{expected_version:0},"support");
 h.s.events.push({...h.s.events[0]!,id:"2",enabled:false,effective_at:String(h.s.now+1000)});h.s.now+=2000;
 expect(await reconcileInitiativeSupport(h.deps)).toBe(1);expect(h.s.row!.version).toBe(2);expect(h.s.supportLogs.filter(l=>l[3]==="excluded")).toHaveLength(1);
 await reconcileInitiativeSupport(h.deps);expect(h.s.supportLogs.filter(l=>l[3]==="excluded")).toHaveLength(1);
 h.s.row!.stage="completed";expect(await reconcileInitiativeSupport(h.deps)).toBe(0);expect(await reconcileInitiativeSupport(h.deps,Date.now()-1)).toBe(0);
});
