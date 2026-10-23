import { expect,it } from "vitest";
import { createModerationAction,appealModerationAction,resolveModerationAppeal,readModerationAction } from "./moderation.ts";
import { addInitiativeComment,readInitiativeComment } from "./comments.ts";
import { moderationFixture,itemId,commentId,actionId,appealId } from "./moderation.test-support.ts";
it("ограничение требует будущего срока/причины; target вычисляется сервером; чужая область и техадмин запрещены",async()=>{
 const h=moderationFixture(),base={initiative_id:itemId,kind:"restrict_author",reason:"Повторное нарушение",until_at:"2026-10-24T10:00:00Z",expected_version:2};
 await expect(createModerationAction(h.deps,h.manager,{...base,until_at:"2026-10-23T09:00:00Z"},"expired")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(createModerationAction(h.deps,h.manager,{...base,target_person_id:"other"},"spoof")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(createModerationAction(h.deps,h.foreign,base,"scope")).rejects.toMatchObject({code:"NOT_FOUND"});
 const row=await createModerationAction(h.deps,h.manager,base,"restrict");expect(row).toMatchObject({id:actionId,version:1});expect(h.s.actions[0]!.target_person_id).toBe(h.resident.person.id);
 expect(h.s.outbox).toHaveLength(1);expect(JSON.stringify(h.s.audits)).not.toContain("Повторное нарушение");
});
it("одно открытое оспаривание конкретного действия; только председатель решает, stale/replay не переписывают историю",async()=>{
 const h=moderationFixture();await addInitiativeComment(h.deps,h.resident,itemId,{body:"Оригинал",expected_version:2},"comment");
 await createModerationAction(h.deps,h.manager,{initiative_id:itemId,kind:"hide_comment",comment_id:commentId,reason:"Нарушение",expected_version:2},"hide");
 h.s.members=[];
 await expect(appealModerationAction(h.deps,h.other,actionId,{reason:"Чужое",expected_version:1},"foreign")).rejects.toMatchObject({code:"NOT_FOUND"});
 await appealModerationAction(h.deps,h.resident,actionId,{reason:"Прошу пересмотреть",expected_version:1},"appeal");
 await expect(appealModerationAction(h.deps,h.resident,actionId,{reason:"Повтор",expected_version:1},"duplicate")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
 const input={resolution:"revoke",reason:"Снято",expected_version:1,action_expected_version:1};
 await expect(resolveModerationAppeal(h.deps,h.manager,appealId,input,"resolve")).rejects.toMatchObject({code:"NOT_FOUND"});
 await resolveModerationAppeal(h.deps,h.chair,appealId,input,"resolve");await resolveModerationAppeal(h.deps,h.chair,appealId,input,"resolve");
 expect(h.s.outbox.at(-1)).toMatchObject({template:"notices.initiatives.moderation_revoke",vars:{reason:"Снято"}});
 expect(h.s.decisions).toHaveLength(1);expect(h.s.actions[0]!.version).toBe(2);expect(h.s.actions[0]!.reason).toBe("Нарушение");
 await expect(resolveModerationAppeal(h.deps,h.chair,appealId,input,"other")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
 h.s.members=h.item.approved_building_ids;expect(await readInitiativeComment(h.deps,h.other,commentId)).toMatchObject({body:"Оригинал",hidden:false});
 expect(await readModerationAction(h.deps,h.resident,actionId)).not.toHaveProperty("target_person_id");
});
it("решение может оставить ограничение или сократить срок, но не продлить; оригинальный срок сохраняется",async()=>{
 const h=moderationFixture();await createModerationAction(h.deps,h.manager,{initiative_id:itemId,kind:"restrict_author",reason:"Нарушение",until_at:"2026-10-25T10:00:00Z",expected_version:2},"restrict");
 await appealModerationAction(h.deps,h.resident,actionId,{reason:"Срок",expected_version:1},"appeal");
 const input={resolution:"shorten",reason:"Сокращение",expected_version:1,action_expected_version:1};
 await expect(resolveModerationAppeal(h.deps,h.chair,appealId,{...input,until_at:"2026-10-26T10:00:00Z"},"longer")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await resolveModerationAppeal(h.deps,h.chair,appealId,{...input,until_at:"2026-10-24T10:00:00Z"},"shorter");
 expect(h.s.outbox.at(-1)).toMatchObject({template:"notices.initiatives.moderation_shorten",vars:{reason:"Сокращение",until:"24.10.2026 15:00"}});
 expect(h.s.actions[0]).toMatchObject({original_until_at:"2026-10-25T10:00:00.000Z",until_at:"2026-10-24T10:00:00.000Z"});
});
