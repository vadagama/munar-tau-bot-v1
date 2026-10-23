import { assertEquals,assertRejects } from "@std/assert";
import { matchRoute,type RouteContext } from "./handlers.ts";
import { POLL_ROUTES } from "./poll-handlers.ts";
import { actor,harness,pollId } from "../../core/src/domains/polls/poll.test-support.ts";
import { ApiError } from "../../core/src/errors/api.ts";
function context(h:ReturnType<typeof harness>,body:Record<string,unknown>,id=pollId):RouteContext {
  return {request:new Request(`https://example.test/v1/polls/${id}`,{method:"POST",headers:{"idempotency-key":crypto.randomUUID()}}),
    url:new URL(`https://example.test/v1/polls/${id}`),params:{id},body,actor,realActor:actor,deps:h.deps} as unknown as RouteContext;
}
Deno.test("POL: маршруты используют эффективную персону, ручного close нет",()=>{
  assertEquals(POLL_ROUTES.length,8);
  for(const route of POLL_ROUTES){
    assertEquals(route.action,"poll.use");assertEquals(route.evaluateAs,"effective");
    assertEquals(matchRoute(route.method,route.path.replace(":id",pollId))?.route.path,route.path);
  }
  assertEquals(matchRoute("POST",`/v1/polls/${pollId}/close`),null);
});
Deno.test("POL: транспорт не принимает чужую личность и ручное завершение",async()=>{
  const h=harness();await h.opened();
  const answer=POLL_ROUTES.find(r=>r.method==="POST"&&r.path.endsWith("/answer"))!;
  const transition=POLL_ROUTES.find(r=>r.path.endsWith("/transitions"))!;
  await assertRejects(()=>answer.handler(context(h,{option_key:"private_sat",expected_version:0,person_id:"foreign"})),ApiError);
  await assertRejects(()=>transition.handler(context(h,{action:"close",expected_version:2,reason:"Рано"})),ApiError);
  assertEquals(h.s.answer,null);assertEquals(h.s.poll!.state,"open");
});
Deno.test("POL: HTTP ответ выполняет общую версию и не раскрывает состав",async()=>{
  const h=harness();await h.opened();
  const answer=POLL_ROUTES.find(r=>r.method==="POST"&&r.path.endsWith("/answer"))!;
  const result=await answer.handler(context(h,{option_key:"private_sat",expected_version:0}));
  assertEquals((result.body as {version:number}).version,1);
  const card=POLL_ROUTES.find(r=>r.method==="GET"&&r.path==="/v1/polls/:id")!;
  const body=(await card.handler(context(h,{}))).body as Record<string,unknown>;
  assertEquals("participants" in body,false);assertEquals("answers" in body,false);
  await assertRejects(()=>answer.handler(context(h,{option_key:"private_sun",expected_version:0})),ApiError);
  assertEquals(h.s.answer!.version,1);
});
Deno.test("POL: неверный UUID отклоняется до доменного чтения",async()=>{
  const h=harness(),card=POLL_ROUTES.find(r=>r.method==="GET"&&r.path==="/v1/polls/:id")!;
  await assertRejects(()=>card.handler(context(h,{},"wrong")),ApiError);
});
