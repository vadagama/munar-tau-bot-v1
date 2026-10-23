import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { submitInitiative,transitionInitiative } from "../../src/domains/initiatives/service.ts";
import { addInitiativeComment,listInitiativeComments,readInitiativeComment } from "../../src/domains/initiatives/comments.ts";
import { createModerationAction,appealModerationAction,resolveModerationAppeal } from "../../src/domains/initiatives/moderation.ts";
import { initiativeAudience } from "../../src/domains/initiatives/access.ts";
import type { DbClient } from "../../src/db/client.ts";
async function setup(db:DbClient) {
 await db.query("insert into staff_assignment(person_id,role) values($1,'chairman')",[SEED.testAdminPersonId]);
 const [m]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','IDEA-MOD',true) returning id",[SEED.building1]);
 await db.query("insert into connection(person_id,premises_id,role,basis,status) values($1,$3,'resident','family','active'),($2,$3,'resident','family','active')",[SEED.testAdminPersonId,SEED.testExecutorPersonId,m!.id]);
 const chair=await actorForPerson(db,SEED.testAdminPersonId,true),resident=await actorForPerson(db,SEED.testExecutorPersonId,true),deps={db,audit:new SqlAuditRepo()};
 const item=await submitInitiative(deps,resident,{title:"Обсуждение",body:"Описание",location_text:"Двор",building_ids:[SEED.building1]},"submit");
 await transitionInitiative(deps,chair,item.id,"publish",{reason:"Проверено",expected_version:1,building_ids:[SEED.building1]},"publish");
 return {deps,chair,resident,item};
}
describeWithDb("VS8 MOD: приватность, оспаривание и атомарная история",getDb=>{
 it("скрытие не меняет оригинал; одна открытая жалоба; решение председателя восстанавливает видимость",async()=>{
  const db=getDb(),{deps,chair,resident,item}=await setup(db);
  const comment=await addInitiativeComment(deps,resident,item.id,{body:"Оригинальный текст",expected_version:2},"comment");
  const action=await createModerationAction(deps,chair,{initiative_id:item.id,kind:"hide_comment",comment_id:comment.id,reason:"Причина скрытия",expected_version:2},"hide");
  await db.query("update connection set status='revoked' where person_id=$1",[resident.person.id]);
  expect(await readInitiativeComment(deps,resident,comment.id)).toMatchObject({body:"Оригинальный текст",hidden:true});
  await appealModerationAction(deps,resident,action.id,{reason:"Прошу проверить",expected_version:1},"appeal");
  await expect(appealModerationAction(deps,resident,action.id,{reason:"Ещё раз",expected_version:1},"duplicate")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  const [appeal]=await db.query<{id:string}>("select id from moderation_appeal where action_id=$1",[action.id]);
  const input={resolution:"revoke",reason:"Скрытие снято",expected_version:1,action_expected_version:1};
  await expect(resolveModerationAppeal(deps,resident,appeal!.id,input,"forbidden")).rejects.toMatchObject({code:"NOT_FOUND"});
  await resolveModerationAppeal(deps,chair,appeal!.id,input,"resolve");await resolveModerationAppeal(deps,chair,appeal!.id,input,"resolve");
  expect(await db.query("select id from moderation_decision where action_id=$1",[action.id])).toHaveLength(1);
  expect(await db.query("select id from outbox where payload->>'moderationActionId'=$1",[action.id])).toHaveLength(2);
  await expect(db.query("update initiative_comment set body='Подмена' where id=$1",[comment.id])).rejects.toMatchObject({code:"42501"});
  await expect(db.query("update moderation_action set reason='Подмена' where id=$1",[action.id])).rejects.toMatchObject({code:"23514"});
  await expect(db.query("update moderation_decision set reason='Подмена' where action_id=$1",[action.id])).rejects.toMatchObject({code:"42501"});
  expect((await listInitiativeComments(deps,chair,item.id)).items[0]).toMatchObject({body:"Оригинальный текст",hidden:false});
 },240000);
 it("ограничение учитывается сервером; снятие не переписывает исходный срок, остальные домены не изменяются",async()=>{
  const db=getDb(),{deps,chair,resident,item}=await setup(db),until=new Date(Date.now()+86400000).toISOString();
  const action=await createModerationAction(deps,chair,{initiative_id:item.id,kind:"restrict_author",reason:"Повторные нарушения",until_at:until,expected_version:2},"restrict");
  expect((await initiativeAudience(db,resident.person.id,true)).restricted).toBe(true);
  await expect(addInitiativeComment(deps,resident,item.id,{body:"Нельзя",expected_version:2},"blocked")).rejects.toMatchObject({code:"NOT_FOUND"});
  const appeal=await appealModerationAction(deps,resident,action.id,{reason:"Пересмотреть",expected_version:1},"appeal");
  await resolveModerationAppeal(deps,chair,appeal.id,{resolution:"revoke",reason:"Снято",expected_version:1,action_expected_version:1},"resolve");
  expect((await initiativeAudience(db,resident.person.id,true)).restricted).toBe(false);
  const [original]=await db.query<{original_until_at:Date}>("select original_until_at from moderation_action where id=$1",[action.id]);expect(new Date(original!.original_until_at).toISOString()).toBe(until);
  expect(await addInitiativeComment(deps,resident,item.id,{body:"Снова доступно",expected_version:2},"allowed")).toMatchObject({body:"Снова доступно"});
 },240000);
 it("новые таблицы закрыты RLS и GRANT",async()=>{
  const rows=await getDb().query<{relrowsecurity:boolean;exposed:boolean}>(`select c.relrowsecurity,
   has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT') as exposed
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
   and c.relname=any($1::text[])`,[["initiative_comment","moderation_appeal","moderation_decision"]]);
  expect(rows).toHaveLength(3);for(const row of rows)expect(row).toEqual({relrowsecurity:true,exposed:false});
 });
});
