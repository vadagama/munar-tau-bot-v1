import { audienceContinuous,audienceContinuousBefore, type AudienceInterval } from "../registry/audience-history.ts";
import type { PollOption } from "./input.ts";

export interface PollAnswerSnapshot {
  personId:string; optionKey:string; answeredAt:number; version:number;
}
export interface PollSummary {participants_count:number;distribution:{option_key:string;count:number}[]}

/** Только внутренняя операция закрытия. В DTO выдаётся summary, не participantIds
 * или excluded. Время — точные микросекунды PostgreSQL, а не Date. */
export function calculatePollResult(options:readonly PollOption[],answers:readonly PollAnswerSnapshot[],histories:ReadonlyMap<string,readonly AudienceInterval[]>,closesAt:number,finalBoundary=true) {
  const counts=new Map(options.map(option=>[option.key,0])), seen=new Set<string>();
  const participantIds:string[]=[],excluded:{personId:string;version:number;lostAt:number}[]=[];
  for(const answer of answers){
    if(seen.has(answer.personId) || !counts.has(answer.optionKey))throw new Error("Нарушена уникальность или вариант ответа опроса");
    seen.add(answer.personId);
    const intervals=histories.get(answer.personId)??[];
    const included=finalBoundary?audienceContinuousBefore(intervals,answer.answeredAt,closesAt):audienceContinuous(intervals,answer.answeredAt,closesAt);
    if(included){
      participantIds.push(answer.personId);
      counts.set(answer.optionKey,counts.get(answer.optionKey)!+1);
    }else{
      const interval=intervals.find(item=>item.from<=answer.answeredAt && answer.answeredAt<item.until);
      excluded.push({personId:answer.personId,version:answer.version,lostAt:Math.min(interval?.until??answer.answeredAt,closesAt)});
    }
  }
  const summary:PollSummary={participants_count:participantIds.length,distribution:options.map(option=>({option_key:option.key,count:counts.get(option.key)!}))};
  return {summary,participantIds,excluded};
}
