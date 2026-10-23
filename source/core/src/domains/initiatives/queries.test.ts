import { expect,it,vi } from "vitest";
import { getInitiative,listInitiatives,listModerationAppeals,getModerationAppeal } from "./queries.ts";
import { fixture,id } from "./service.test-support.ts";
import { moderationFixture,itemId,actionId,appealId } from "./moderation.test-support.ts";
import { createModerationAction,appealModerationAction } from "./moderation.ts";
import type { DbClient } from "../../db/client.ts";
vi.mock("./support-state.ts",()=>({initiativeSupportState:vi.fn(async()=>({count:1,people:[],excluded:[]})),persistInitiativeExclusions:vi.fn()}));
it("карточка выдаёт счётчик и личную версию без состава поддержки и снимка документа",async()=>{
 const h=fixture();await h.submit();h.s.row!.decision_snapshot={secret:"Не выдавать"};
 const card=await getInitiative(h.deps,h.actor,id);
 expect(card).toMatchObject({support_count:1,own_support:{version:0,supported:false},can_manage:true});
 expect(JSON.stringify(card)).not.toContain("secret");expect(card).not.toHaveProperty("supporters");expect(card).not.toHaveProperty("author_person_id");
 h.s.row!.final_support_count=7;expect((await getInitiative(h.deps,h.actor,id)).support_count).toBe(7);
});
it("список ограничен и выдаёт только DTO; неверные фильтры отклоняются до запроса",async()=>{
 const h=fixture();await h.submit();const base=h.deps.db;
 const db:DbClient={...base,async query<T>(sql:string,p?:readonly unknown[]){if(sql.startsWith("select i.*"))return [h.s.row] as T[];return base.query<T>(sql,p);},async transaction(fn){return fn(db);}};
 const deps={...h.deps,db};expect((await listInitiatives(deps,h.actor,{limit:1})).items[0]).toMatchObject({id,can_manage:true});
 for(const opts of [{limit:51},{offset:-1},{state:"missing"}])await expect(listInitiatives(deps,h.actor,opts)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
});
it("оспаривание читают автор и председатель; администратор не получает частную аргументацию",async()=>{
 const h=moderationFixture();await createModerationAction(h.deps,h.manager,{initiative_id:itemId,kind:"restrict_author",reason:"Нарушение",until_at:"2026-10-24T10:00:00Z",expected_version:2},"restrict");
 await appealModerationAction(h.deps,h.resident,actionId,{reason:"Моя частная аргументация",expected_version:1},"appeal");
 expect(await getModerationAppeal(h.deps,h.resident,appealId)).toMatchObject({reason:"Моя частная аргументация"});
 expect(await getModerationAppeal(h.deps,h.chair,appealId)).toMatchObject({reason:"Моя частная аргументация"});
 await expect(getModerationAppeal(h.deps,h.manager,appealId)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(listModerationAppeals(h.deps,h.resident,{offset:-1})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
});
