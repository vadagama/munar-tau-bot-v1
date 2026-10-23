import { expect,it } from "vitest";
import { submissionInput,planInput } from "./input.ts";
import { B1 } from "../../testing/actors.ts";
const person="20000000-0000-4000-8000-000000000001",doc="30000000-0000-4000-8000-000000000001";
it("подача принимает только текст и выбранную аудиторию, без доверенного автора и статуса",()=>{
  const body={title:" Встреча ",body:"Описание",location_text:"Двор",building_ids:[B1]};
  expect(submissionInput(body)).toEqual({...body,title:"Встреча"});
  expect(()=>submissionInput({...body,author_person_id:person})).toThrow();
  expect(()=>submissionInput({...body,publication_state:"published"})).toThrow();
  expect(()=>submissionInput({...body,building_ids:[B1,B1]})).toThrow();
  expect(()=>submissionInput({...body,building_ids:[]})).toThrow();
});
it("планирование требует основание, сотрудника, срок и нужный документ",()=>{
  const input={basis:"Решение ОСИ",responsible_person_id:person,estimated_due_at:"2026-11-01T12:00:00+05:00"};
  expect(planInput(false,input)).toMatchObject({basis:"Решение ОСИ",owner_decision_required:false});
  for(const field of ["basis","responsible_person_id","estimated_due_at"]){const copy={...input} as Record<string,unknown>;delete copy[field];expect(()=>planInput(false,copy)).toThrow();}
  expect(()=>planInput(true,input)).toThrow();
  expect(planInput(true,{...input,decision_document_version_id:doc})).toMatchObject({owner_decision_required:true,decision_document_version_id:doc});
});
it("сохранённую обязательность решения нельзя снять флагом; ложная approved-версия не принимается из тела",()=>{
  const input={basis:"Основание",responsible_person_id:person,estimated_due_at:"2026-11-01T12:00:00Z",decision_document_version_id:doc};
  expect(()=>planInput(true,{...input,owner_decision_required:false})).toThrow();
  expect(()=>planInput(true,{...input,approved:true})).toThrow();
  expect(()=>planInput(false,{...input,estimated_due_at:"2026-11-01T12:00:00"})).toThrow();
});
