import type { Route,RouteContext } from "./handlers.ts";
import { databaseValidation,invalid } from "../../core/src/domains/registry/validation.ts";
import { answerPoll,getPoll,openPoll,savePoll } from "../../core/src/domains/polls/service.ts";
import { listPolls } from "../../core/src/domains/polls/list.ts";
import { cancelPoll,getPollResults } from "../../core/src/domains/polls/transitions.ts";
const deps=(c:RouteContext)=>({db:c.deps.db,audit:c.deps.audit});
const key=(c:RouteContext)=>c.request.headers.get("idempotency-key");
function id(c:RouteContext):string {
  const value=c.params.id;
  if(!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))invalid("Некорректный идентификатор опроса");
  return value.toLowerCase();
}
function route(method:Route["method"],path:string,handler:Route["handler"]):Route {
  return {method,path,action:"poll.use",evaluateAs:"effective",handler:c=>databaseValidation(()=>handler(c))};
}
export const POLL_ROUTES:Route[]=[
  route("GET","/v1/polls",async c=>({body:await listPolls(deps(c),c.actor,{offset:Number(c.url.searchParams.get("offset")??0),limit:Number(c.url.searchParams.get("limit")??20),state:c.url.searchParams.get("state")??undefined})})),
  route("POST","/v1/polls",async c=>({status:201,body:await savePoll(deps(c),c.actor,null,c.body,key(c))})),
  route("GET","/v1/polls/:id",async c=>({body:await getPoll(deps(c),c.actor,id(c))})),
  route("PATCH","/v1/polls/:id",async c=>({body:await savePoll(deps(c),c.actor,id(c),c.body,key(c))})),
  route("POST","/v1/polls/:id/transitions",async c=>{
    const action=c.body.action;
    if(action!=="open"&&action!=="cancel")invalid("Допустимы только открытие и отмена опроса");
    return {body:await (action==="open"?openPoll:cancelPoll)(deps(c),c.actor,id(c),c.body,key(c))};
  }),
  ...(["POST","PATCH"] as const).map(method=>route(method,"/v1/polls/:id/answer",async c=>({body:await answerPoll(deps(c),c.actor,id(c),c.body,key(c))}))),
  route("GET","/v1/polls/:id/results",async c=>({body:await getPollResults(deps(c),c.actor,id(c))})),
];
