import { content } from "../requests/service.ts";
import { invalid, type Row } from "../registry/validation.ts";

export interface PollOption { key:string; label:string }
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function pollInput(input:Row) {
  const question=content(input.question,"вопрос");
  if(question.length>2000) invalid("Вопрос не длиннее 2000 символов");
  if(!Array.isArray(input.options) || input.options.length<2 || input.options.length>20) invalid("Укажите от 2 до 20 вариантов");
  const options=input.options.map((value):PollOption=>{
    if(!value || typeof value!=="object" || Array.isArray(value)) invalid("Некорректный вариант");
    const key=content(value.key,"ключ варианта"), label=content(value.label,"подпись варианта");
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || label.length>300) invalid("Некорректный ключ или подпись варианта");
    return {key,label};
  });
  if(new Set(options.map(option=>option.key)).size!==options.length) invalid("Ключи вариантов не повторяются");
  const ids=input.building_ids;
  if(!Array.isArray(ids) || !ids.length || ids.length>100 || ids.some(id=>typeof id!=="string" || !UUID.test(id))) invalid("Укажите дома опроса");
  const building_ids=ids.map((id:string)=>id.toLowerCase());
  if(new Set(building_ids).size!==building_ids.length) invalid("Дома не повторяются");
  if(typeof input.closes_at!=="string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.closes_at) || !Number.isFinite(Date.parse(input.closes_at))) invalid("Укажите срок опроса с часовым поясом");
  return {question,options,building_ids,closes_at:new Date(input.closes_at).toISOString()};
}
export function answerInput(input:Row) {
  if(Object.keys(input).some(key=>!["option_key","expected_version"].includes(key))) invalid("Ответ принимает только вариант и версию личного ответа");
  const option_key=content(input.option_key,"вариант");
  if(typeof input.expected_version!=="number" || !Number.isSafeInteger(input.expected_version) || input.expected_version<0) invalid("Нужна версия личного ответа");
  return {option_key,expected_version:input.expected_version};
}
