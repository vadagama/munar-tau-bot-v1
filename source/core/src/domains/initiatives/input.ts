import { invalid,type Row } from "../registry/validation.ts";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function initiativeUuid(value:unknown,name:string):string {
  if(typeof value!=="string" || !uuid.test(value))invalid(`Неверный ${name}`);
  return value.toLowerCase();
}
export function initiativeFields(input:Row,allowed:readonly string[]) {
  if(Object.keys(input).some(key=>!allowed.includes(key)))invalid("Неизвестные поля инициативы");
}
export function initiativeText(value:unknown,name:string,max:number):string {
  if(typeof value!=="string" || !value.trim() || value.trim().length>max)invalid(`Заполните ${name} (до ${max} символов)`);
  return value.trim();
}
export function initiativeBuildings(value:unknown):string[] {
  if(!Array.isArray(value) || value.length<1 || value.length>100)invalid("Выберите от 1 до 100 зданий");
  const ids=value.map(id=>initiativeUuid(id,"идентификатор здания"));
  if(new Set(ids).size!==ids.length)invalid("Здания не должны повторяться");
  return ids;
}
export function submissionInput(input:Row) {
  initiativeFields(input,["title","body","location_text","building_ids"]);
  return {title:initiativeText(input.title,"название",300),body:initiativeText(input.body,"описание",10000),
    location_text:initiativeText(input.location_text,"место",500),building_ids:initiativeBuildings(input.building_ids)};
}
/** Обязательность из сохранённой карточки нельзя отменить входным флагом. */
export function planInput(required:boolean,input:Row) {
  initiativeFields(input,["basis","responsible_person_id","estimated_due_at","owner_decision_required","decision_document_version_id","reason","expected_version"]);
  if(input.owner_decision_required!==undefined && typeof input.owner_decision_required!=="boolean")invalid("Укажите необходимость решения собственников");
  if(required && input.owner_decision_required===false)invalid("Нельзя снять сохранённое требование решения собственников");
  const owner_decision_required=required || input.owner_decision_required===true;
  const due=input.estimated_due_at;
  if(typeof due!=="string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(due) || !Number.isFinite(Date.parse(due)))invalid("Укажите ориентировочный срок с часовым поясом");
  const document=input.decision_document_version_id;
  if(owner_decision_required && !document)invalid("Нужна проверенная версия решения собственников");
  return {basis:initiativeText(input.basis,"основание",2000),responsible_person_id:initiativeUuid(input.responsible_person_id,"ответственный"),
    estimated_due_at:new Date(due).toISOString(),owner_decision_required,
    decision_document_version_id:document?initiativeUuid(document,"версия документа"):null};
}
