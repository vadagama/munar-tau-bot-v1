import { beforeEach,expect,it,vi } from "vitest";
import { checkedDocumentVersions } from "../documents/provider.ts";
import { checkedInitiativeDecision } from "./planning.ts";
import { requireDocument,documentVersionReadable } from "../documents/access.ts";
import { B1,makeTestActor } from "../../testing/actors.ts";
import type { DbExecutor } from "../../db/client.ts";
vi.mock("../documents/provider.ts",()=>({checkedDocumentVersions:vi.fn()}));
vi.mock("../documents/access.ts",()=>({requireDocument:vi.fn(),documentResource:vi.fn(async()=>({})),documentVersionReadable:vi.fn(()=>true)}));
const actor=makeTestActor("administrator",[B1]);
const doc={id:"doc",kind:"decision_basis",is_test:false,title:"Решение",document_number:"42",document_date:"2026-10-23",phone:"скрыто"};
const version={id:"version",document_id:"doc",version:2,state:"approved",was_published:false,attachment_id:"file",signed_attachment_id:"signed"};
function executor(value:object=version):DbExecutor{return {query:async<T>(sql:string):Promise<T[]>=>sql.startsWith("select document_id")?[{document_id:"doc"}] as T[]:[value] as T[]};}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requireDocument).mockResolvedValue(doc as never);vi.mocked(documentVersionReadable).mockReturnValue(true);vi.mocked(checkedDocumentVersions).mockImplementation(async(_exec,_actor,_ids,scope)=>{if(scope.some(id=>id!==B1))throw Object.assign(new Error("Охват не соответствует"),{code:"VALIDATION_FAILED"});return [{...doc,...version,kind:"decision_basis",is_test:false}] as never;});});
it("снимок содержит конкретную версию и файлы, доступ документа проверяется с блокировкой",async()=>{
  const db=executor(),snapshot=await checkedInitiativeDecision(db,actor,"version",[B1]);
  expect(requireDocument).toHaveBeenCalledWith(db,actor,"doc","document.read",true);
  expect(snapshot).toMatchObject({id:"version",version:2,attachment_id:"file",signed_attachment_id:"signed"});
  expect(JSON.stringify(snapshot)).not.toContain("скрыто");
});
it("needs_fix, чужой режим и иной тип документа не становятся решением собственников",async()=>{
  await expect(checkedInitiativeDecision(executor({...version,state:"needs_fix"}),actor,"version",[B1])).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  vi.mocked(requireDocument).mockResolvedValue({...doc,is_test:true} as never);
  await expect(checkedInitiativeDecision(executor(),actor,"version",[B1])).rejects.toMatchObject({code:"INVALID_TRANSITION"});
  vi.mocked(requireDocument).mockResolvedValue({...doc,kind:"invoice"} as never);
  await expect(checkedInitiativeDecision(executor(),actor,"version",[B1])).rejects.toMatchObject({code:"INVALID_TRANSITION"});
});
it("недоступная версия не раскрывается снимком даже при approved",async()=>{
  vi.mocked(documentVersionReadable).mockReturnValue(false);
  await expect(checkedInitiativeDecision(executor(),actor,"version",[B1])).rejects.toMatchObject({code:"INVALID_TRANSITION"});
});

it("решение другого дома отклоняется общим provider до сохранения снимка",async()=>{
  await expect(checkedInitiativeDecision(executor(),actor,"version",["b2000000-0000-0000-0000-000000000002"])).rejects.toMatchObject({code:"VALIDATION_FAILED"});
});
