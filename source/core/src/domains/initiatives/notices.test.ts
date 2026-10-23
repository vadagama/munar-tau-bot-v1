import { expect,it } from "vitest";
import { moderationFixture,itemId,actionId } from "./moderation.test-support.ts";
import { createModerationAction } from "./moderation.ts";
import { moderationNoticeAllowed } from "./notices.ts";
it("персональное решение не теряется после переезда и не доставляется другому человеку",async()=>{
 const h=moderationFixture();await createModerationAction(h.deps,h.manager,{initiative_id:itemId,kind:"restrict_author",reason:"Повтор",until_at:"2026-10-24T10:00:00Z",expected_version:2},"restrict");
 h.s.members=[];expect(await moderationNoticeAllowed(h.deps.db,h.resident,actionId)).toBe(true);
 expect(await moderationNoticeAllowed(h.deps.db,h.chair,actionId)).toBe(false);h.resident.person.status="archived";
 expect(await moderationNoticeAllowed(h.deps.db,h.resident,actionId)).toBe(false);
});
