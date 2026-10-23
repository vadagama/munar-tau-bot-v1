export interface PollOption {key:string;label:string}
export interface PollBase {
  id:string;question:string;options:PollOption[];building_ids:string[];buildings:{id:string;label:string}[];
  closes_at:string;state:"draft"|"open"|"closed"|"canceled";version:number;cancel_reason:string|null;informational:boolean;
}
export interface PollView extends PollBase {can_manage:boolean;can_answer:boolean;can_results:boolean;deadline_passed:boolean}
export interface PollSummary {participants_count:number;distribution:{option_key:string;count:number}[];as_of:string;final:boolean}
export const pollStates={draft:"Черновик",open:"Открыт",closed:"Завершён",canceled:"Отменён"};
export function pollDate(value:string):string {
  const date=new Date(value);
  return Number.isFinite(+date)?new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Almaty",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date).replace(",",""):"—";
}
