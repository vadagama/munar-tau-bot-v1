import { listInitiativePhotos,discardInitiativePhoto } from "../../core/src/domains/initiatives/files.ts";
import { requireInitiative } from "../../core/src/domains/initiatives/access.ts";
import { listTaskAssignees } from "../../core/src/domains/tasks/assignees.ts";
import type { Route,RouteContext } from "./handlers.ts";
import { databaseValidation,invalid } from "../../core/src/domains/registry/validation.ts";
import { initiativeUuid } from "../../core/src/domains/initiatives/input.ts";
import { submitInitiative,transitionInitiative } from "../../core/src/domains/initiatives/service.ts";
import { setInitiativeSupport } from "../../core/src/domains/initiatives/support.ts";
import { addInitiativeComment,listInitiativeComments,readInitiativeComment } from "../../core/src/domains/initiatives/comments.ts";
import { createModerationAction,appealModerationAction,resolveModerationAppeal } from "../../core/src/domains/initiatives/moderation.ts";
import { getInitiative,getInitiativeHistory,listInitiatives,getModerationAction,listModerationActions,getModerationAppeal,listModerationAppeals } from "../../core/src/domains/initiatives/queries.ts";
const deps=(c:RouteContext)=>({db:c.deps.db,audit:c.deps.audit});
const key=(c:RouteContext)=>c.request.headers.get("idempotency-key");
const id=(c:RouteContext)=>initiativeUuid(c.params.id,"идентификатор");
const page=(c:RouteContext)=>({offset:Number(c.url.searchParams.get("offset")??0),limit:Number(c.url.searchParams.get("limit")??20),state:c.url.searchParams.get("state")??undefined});
function route(method:Route["method"],path:string,handler:Route["handler"]):Route {return {method,path,action:"initiative.use",evaluateAs:"effective",handler:c=>databaseValidation(()=>handler(c))};}
export const INITIATIVE_ROUTES:Route[]=[
 route("GET","/v1/initiatives/:id/photos",async c=>({body:{items:await listInitiativePhotos(deps(c),c.actor,id(c))}})),
 route("POST","/v1/initiatives/:id/photos/:fileId/discard",async c=>({body:await discardInitiativePhoto(deps(c),c.actor,id(c),initiativeUuid(c.params.fileId,"файл"),c.body,key(c))})),
 route("GET","/v1/initiatives",async c=>({body:await listInitiatives(deps(c),c.actor,page(c))})),
 route("POST","/v1/initiatives",async c=>({status:201,body:await submitInitiative(deps(c),c.actor,c.body,key(c))})),
 route("GET","/v1/initiatives/:id",async c=>({body:await getInitiative(deps(c),c.actor,id(c))})),
 route("GET","/v1/initiatives/:id/planning-options",async c=>{const row=await requireInitiative(c.deps.db,c.actor,id(c),"initiative.manage");return {body:{items:await listTaskAssignees(c.deps.db,row.is_test,row.approved_building_ids)}};}),
 route("GET","/v1/initiatives/:id/history",async c=>({body:await getInitiativeHistory(deps(c),c.actor,id(c),page(c))})),
 route("POST","/v1/initiatives/:id/transitions",async c=>{
  const {action,...input}=c.body;if(typeof action!=="string"||!["publish","reject","assessing","planned","implementing","completed","rejected","deferred"].includes(action))invalid("Неизвестный переход инициативы");
  return {body:await transitionInitiative(deps(c),c.actor,id(c),action,input,key(c))};
 }),
 route("POST","/v1/initiatives/:id/support",async c=>({body:await setInitiativeSupport(deps(c),c.actor,id(c),true,c.body,key(c))})),
 route("DELETE","/v1/initiatives/:id/support",async c=>{
  const version=c.url.searchParams.get("expected_version");if(version===null||!/^\d+$/.test(version)||!Number.isSafeInteger(Number(version)))invalid("Нужна личная expected_version в параметрах запроса");
  return {body:await setInitiativeSupport(deps(c),c.actor,id(c),false,{expected_version:Number(version)},key(c))};
 }),
 route("GET","/v1/initiatives/:id/comments",async c=>({body:await listInitiativeComments(deps(c),c.actor,id(c),page(c).offset)})),
 route("POST","/v1/initiatives/:id/comments",async c=>({status:201,body:await addInitiativeComment(deps(c),c.actor,id(c),c.body,key(c))})),
 route("GET","/v1/initiative-comments/:id",async c=>({body:await readInitiativeComment(deps(c),c.actor,id(c))})),
 route("GET","/v1/moderation/actions",async c=>({body:await listModerationActions(deps(c),c.actor,page(c))})),
 route("POST","/v1/moderation/actions",async c=>({status:201,body:await createModerationAction(deps(c),c.actor,c.body,key(c))})),
 route("GET","/v1/moderation/actions/:id",async c=>({body:await getModerationAction(deps(c),c.actor,id(c))})),
 route("POST","/v1/moderation/:id/appeal",async c=>({status:201,body:await appealModerationAction(deps(c),c.actor,id(c),c.body,key(c))})),
 route("GET","/v1/moderation/appeals",async c=>({body:await listModerationAppeals(deps(c),c.actor,page(c))})),
 route("GET","/v1/moderation/appeals/:id",async c=>({body:await getModerationAppeal(deps(c),c.actor,id(c))})),
 route("POST","/v1/moderation/appeals/:id/resolve",async c=>({body:await resolveModerationAppeal(deps(c),c.actor,id(c),c.body,key(c))})),
];
