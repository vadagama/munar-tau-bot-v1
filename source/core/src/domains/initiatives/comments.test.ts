import { expect,it } from "vitest";
import { addInitiativeComment,listInitiativeComments,readInitiativeComment } from "./comments.ts";
import { createModerationAction } from "./moderation.ts";
import { moderationFixture,itemId,commentId } from "./moderation.test-support.ts";
it("комментарий неизменяем, повтор идемпотентен, DTO содержит имя без контактов",async()=>{
 const h=moderationFixture();const comment=await addInitiativeComment(h.deps,h.resident,itemId,{body:"Давайте обсудим",expected_version:2},"comment");
 await addInitiativeComment(h.deps,h.resident,itemId,{body:"Давайте обсудим",expected_version:2},"comment");
 expect(h.s.comments).toHaveLength(1);expect(comment).toMatchObject({body:"Давайте обсудим",author_name:"Житель"});expect(comment).not.toHaveProperty("author_person_id");
 await expect(addInitiativeComment(h.deps,h.resident,itemId,{body:"Текст",author_person_id:"other"},"spoof")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 h.s.restricted=true;await expect(addInitiativeComment(h.deps,h.resident,itemId,{body:"Текст",expected_version:2},"restricted")).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("скрытый оригинал видят автор и управляющий, посторонний не получает его по UUID или из списка",async()=>{
 const h=moderationFixture();await addInitiativeComment(h.deps,h.resident,itemId,{body:"Оригинал",expected_version:2},"comment");
 await createModerationAction(h.deps,h.manager,{initiative_id:itemId,kind:"hide_comment",comment_id:commentId,reason:"Нарушение",expected_version:2},"hide");
 expect((await listInitiativeComments(h.deps,h.other,itemId,0)).items).toEqual([]);
 await expect(readInitiativeComment(h.deps,h.other,commentId)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(await readInitiativeComment(h.deps,h.manager,commentId)).toMatchObject({body:"Оригинал",hidden:true});
 h.s.members=[];expect(await readInitiativeComment(h.deps,h.resident,commentId)).toMatchObject({body:"Оригинал",hidden:true});
 expect(h.s.comments[0]!.body).toBe("Оригинал");
});
