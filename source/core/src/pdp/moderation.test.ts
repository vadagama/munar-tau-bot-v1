import { expect,it } from "vitest";
import { can } from "./evaluate.ts";
import { B1,B2,makeTestActor } from "../testing/actors.ts";
const resource={moderationAccess:{targetPersonId:"author",isTest:false,buildingIds:[B1]}};
it("собственное оспаривание доступно без связи; разрешение только председателю, техроль не даёт модерацию",()=>{
 const author=makeTestActor("executor",[],{personId:"author"});author.assignments=[];
 expect(can(author,"moderation.read",resource).allow).toBe(true);expect(can(author,"moderation.appeal",resource).allow).toBe(true);expect(can(author,"moderation.resolve",resource).allow).toBe(false);
 expect(can(makeTestActor("tech_admin",[]),"moderation.read",resource).allow).toBe(false);
 expect(can(makeTestActor("administrator",[B2]),"moderation.read",resource).allow).toBe(false);
 expect(can(makeTestActor("administrator",[B1]),"moderation.read",resource).allow).toBe(true);
 expect(can(makeTestActor("chairman",[]),"moderation.resolve",resource).allow).toBe(true);
 expect(can(makeTestActor("chairman",[],{isTest:true}),"moderation.resolve",resource).allow).toBe(false);
});
