import { expect,it } from "vitest";
import { can } from "./evaluate.ts";
import { B1,B2,makeTestActor } from "../testing/actors.ts";
import type { ResourceRef } from "./types.ts";
const access={buildingIds:[B1],requestedBuildingIds:[B1],isTest:false,authorId:"author",publicationState:"published" as const,stage:"collecting" as const,member:true,allRequestedMember:true,restricted:false};
const resource:ResourceRef={initiativeAccess:access};
it("текущая аудитория даёт поддержку и комментарий, служебная роль не заменяет связь",()=>{
  const a=makeTestActor("administrator",[B1]);
  expect(can(a,"initiative.support",resource).allow).toBe(true);
  expect(can(a,"initiative.comment",resource).allow).toBe(true);
  const lost={initiativeAccess:{...access,member:false}};
  expect(can(a,"initiative.support",lost).allow).toBe(false);
  expect(can(a,"initiative.comment",lost).allow).toBe(false);
  expect(can(a,"initiative.manage",lost).allow).toBe(true);
});
it("менеджер охватывает все дома, техадминистратор не модерирует, режимы изолированы",()=>{
  expect(can(makeTestActor("administrator",[B1]),"initiative.manage",{initiativeAccess:{...access,buildingIds:[B1,B2]}}).allow).toBe(false);
  expect(can(makeTestActor("chairman",[]),"initiative.manage",{initiativeAccess:{...access,buildingIds:[B1,B2]}}).allow).toBe(true);
  expect(can(makeTestActor("tech_admin",[B1]),"initiative.moderate",resource).allow).toBe(false);
  expect(can(makeTestActor("chairman",[]),"initiative.read",{initiativeAccess:{...access,isTest:true}}).allow).toBe(false);
});
it("автор видит своё непубличное решение; опубликованная карточка требует аудиторию",()=>{
  const a=makeTestActor("executor",[B1]);a.assignments=[];
  const own={...access,authorId:a.person.id,member:false};
  expect(can(a,"initiative.read",{initiativeAccess:{...own,publicationState:"rejected",stage:null}}).allow).toBe(true);
  expect(can(a,"initiative.read",{initiativeAccess:own}).allow).toBe(false);
  expect(can(a,"initiative.read",{initiativeAccess:{...own,publicationState:"submitted",authorId:"other",stage:null}}).allow).toBe(false);
});
it("ограничение блокирует подачу и комментарии, но не поддержку и другие модули",()=>{
  const a=makeTestActor("executor",[B1]);
  const restricted={initiativeAccess:{...access,restricted:true}};
  expect(can(a,"initiative.create",restricted).allow).toBe(false);
  expect(can(a,"initiative.comment",restricted).allow).toBe(false);
  expect(can(a,"initiative.support",restricted).allow).toBe(true);
  expect(can(a,"initiative.create",{initiativeAccess:{...access,allRequestedMember:false}}).allow).toBe(false);
  expect(can(a,"initiative.support",{initiativeAccess:{...access,stage:"completed"}}).allow).toBe(false);
});
