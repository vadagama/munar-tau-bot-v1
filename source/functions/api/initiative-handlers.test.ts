import { assertEquals,assertRejects } from "@std/assert";
import { matchRoute,type RouteContext } from "./handlers.ts";
import { INITIATIVE_ROUTES } from "./initiative-handlers.ts";
import { fixture,id } from "../../core/src/domains/initiatives/service.test-support.ts";
import { moderationFixture,itemId,commentId,actionId,appealId } from "../../core/src/domains/initiatives/moderation.test-support.ts";
import { B1 } from "../../core/src/testing/actors.ts";
import { ApiError } from "../../core/src/errors/api.ts";
function context(deps:unknown,actor:unknown,body:Record<string,unknown>,value=id):RouteContext {
 const url=new URL("https://example.test/v1/initiatives");if(body.expected_version!==undefined)url.searchParams.set("expected_version",String(body.expected_version));
 return {request:new Request("https://example.test/v1/initiatives",{method:"POST",headers:{"idempotency-key":crypto.randomUUID()}}),url,params:{id:value},body,actor,realActor:actor,deps} as unknown as RouteContext;
}
function handler(method:string,path:string) {return INITIATIVE_ROUTES.find(r=>r.method===method&&r.path===path)!.handler;}
Deno.test("IDEA/MOD: маршруты эффективной персоны, оригиналы не редактируются",()=>{
 assertEquals(INITIATIVE_ROUTES.length,17);
 for(const r of INITIATIVE_ROUTES){assertEquals(r.action,"initiative.use");assertEquals(r.evaluateAs,"effective");assertEquals(matchRoute(r.method,r.path.replace(":id",id))?.route.path,r.path);}
 assertEquals(matchRoute("PATCH",`/v1/initiative-comments/${commentId}`),null);assertEquals(matchRoute("DELETE",`/v1/initiatives/${id}`),null);
});
Deno.test("IDEA: общий домен поддержки и личная версия, UUID проверяется до SQL",async()=>{
 const h=fixture();await h.submit();Object.assign(h.s.row!,{publication_state:"published",stage:"collecting",approved_building_ids:[B1],version:2});
 const support=handler("POST","/v1/initiatives/:id/support"),withdraw=handler("DELETE","/v1/initiatives/:id/support");
 assertEquals((await support(context(h.deps,h.actor,{expected_version:0}))).body,{supported:true,version:1});
 await assertRejects(()=>support(context(h.deps,h.actor,{expected_version:1,person_id:"other"})),ApiError);
 await assertRejects(()=>withdraw(context(h.deps,h.actor,{expected_version:0})),ApiError);
 assertEquals((await withdraw(context(h.deps,h.actor,{expected_version:1}))).body,{supported:false,version:2});
 await assertRejects(()=>handler("GET","/v1/initiatives/:id")(context(h.deps,h.actor,{},"bad")),ApiError);
});
Deno.test("MOD: скрытый оригинал и оспаривание проходят доменные права, решение только председателю",async()=>{
 const h=moderationFixture(),add=handler("POST","/v1/initiatives/:id/comments");
 await add(context(h.deps,h.resident,{body:"Оригинал",expected_version:2},itemId));
 await handler("POST","/v1/moderation/actions")(context(h.deps,h.manager,{initiative_id:itemId,kind:"hide_comment",comment_id:commentId,reason:"Причина",expected_version:2}));
 const read=handler("GET","/v1/initiative-comments/:id");
 await assertRejects(()=>read(context(h.deps,h.other,{},commentId)),ApiError);
 assertEquals(((await read(context(h.deps,h.resident,{},commentId))).body as {body:string}).body,"Оригинал");
 await handler("POST","/v1/moderation/:id/appeal")(context(h.deps,h.resident,{reason:"Прошу проверить",expected_version:1},actionId));
 const resolve=handler("POST","/v1/moderation/appeals/:id/resolve"),input={resolution:"revoke",reason:"Снято",expected_version:1,action_expected_version:1};
 await assertRejects(()=>resolve(context(h.deps,h.manager,input,appealId)),ApiError);
 assertEquals(((await resolve(context(h.deps,h.chair,input,appealId))).body as {status:string}).status,"resolved");
});

Deno.test("IDEA: переход извлекает action отдельно и сохраняет публикацию общим сервисом",async()=>{
 const h=fixture();await h.submit();const transition=handler("POST","/v1/initiatives/:id/transitions");
 const result=await transition(context(h.deps,h.actor,{action:"publish",reason:"Проверено",building_ids:[B1],expected_version:1}));
 assertEquals((result.body as {publication_state:string}).publication_state,"published");
 await assertRejects(()=>transition(context(h.deps,h.actor,{action:"delete",reason:"Нельзя",expected_version:2})),ApiError);
});
