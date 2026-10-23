import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { actorForPerson } from "../../src/domains/documents/service.ts";
import { submitInitiative,transitionInitiative } from "../../src/domains/initiatives/service.ts";
import { prepareFile,completeFile,type FileStorage } from "../../src/domains/requests/files.ts";
import { discardInitiativePhoto } from "../../src/domains/initiatives/files.ts";
describeWithDb("VS-8 приватные фото инициатив",getDb=>{
 it("версионирует состав, блокирует неполную публикацию, сохраняет frozen оригинал",async()=>{
  const db=getDb();await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')",[SEED.testAdminPersonId]);
  const [p]=await db.query<{id:string}>("insert into premises(building_id,kind,number,is_test) values($1,'apartment','IDEA-photo',true) returning id",[SEED.building1]);
  await db.query("insert into connection(person_id,premises_id,role,basis,status) values($1,$2,'resident','family','active')",[SEED.testAdminPersonId,p!.id]);
  const actor=await actorForPerson(db,SEED.testAdminPersonId,true),deps={db,audit:new SqlAuditRepo()},row=await submitInitiative(deps,actor,{title:"Фото",body:"Двор",location_text:"Двор",building_ids:[SEED.building1]},"create");
  const f=await prepareFile(deps,actor,{owner_type:"initiative",owner_id:row.id,expected_version:1,filename:"photo.jpg",size:3,mime:"image/jpeg"});expect(f.initiative_version).toBe(2);
  const body={expected_version:2,reason:"Проверено",building_ids:[SEED.building1]};await expect(transitionInitiative(deps,actor,row.id,"publish",body,"publish")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  const storage:FileStorage={put:async()=>{},info:async()=>({size:3,mime:"image/jpeg"}),sign:async()=>"unused"};await completeFile(deps,storage,actor,String(f.attachment_id));
  await expect(transitionInitiative(deps,actor,row.id,"publish",body,"old")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
  await transitionInitiative(deps,actor,row.id,"publish",{...body,expected_version:3},"publish");
  await expect(db.query("update attachment set filename='renamed.jpg' where id=$1",[f.attachment_id])).rejects.toMatchObject({code:"23514"});
  await expect(discardInitiativePhoto(deps,actor,row.id,String(f.attachment_id),{expected_version:4},"remove")).rejects.toMatchObject({code:"NOT_FOUND"});
 },240000);
});
