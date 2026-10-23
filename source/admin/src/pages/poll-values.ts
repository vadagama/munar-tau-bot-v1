import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import type { PollBase } from "./poll-types";
dayjs.extend(utc);dayjs.extend(timezone);
export function pollEditorValues(poll:PollBase){
  return {question:poll.question,options:poll.options.map(option=>({...option})),building_ids:[...poll.building_ids],closes_at:dayjs(poll.closes_at).tz("Asia/Almaty")};
}
export function pollDraftBody(values:Record<string,unknown>,version?:number){
  if(!dayjs.isDayjs(values.closes_at)||!values.closes_at.isValid())throw new Error("Укажите окончание опроса");
  return {question:values.question,options:values.options,building_ids:values.building_ids,
    closes_at:dayjs.tz(values.closes_at.format("YYYY-MM-DDTHH:mm:ss"),"Asia/Almaty").toISOString(),reason:values.reason,
    ...(version===undefined?{}:{expected_version:version})};
}
export function newPollOption(){return {key:`option_${crypto.randomUUID()}`,label:""};}
