import { assertEquals, assertRejects } from "@std/assert";
import { TEMPLATE_ROUTES } from "./template-handlers.ts";
import { makeTestActor } from "../../core/src/testing/actors.ts";
import type { RouteContext } from "./handlers.ts";
Deno.test("шаблоны: маршруты защищены PDP, preview требует ключ и валидирует HTML", async () => {
  assertEquals(TEMPLATE_ROUTES.length, 4);
  assertEquals(
    TEMPLATE_ROUTES.find((r) => r.path === "/v1/templates/:key")?.action,
    "settings.templates.edit",
  );
  const route = TEMPLATE_ROUTES.find((r) =>
    r.path === "/v1/templates/preview"
  )!;
  const context = {
    actor: makeTestActor("administrator", []),
    body: { key: "errors.INTERNAL", text_ru: "<b>Сбой</b>", text_kk: "Қате" },
    request: new Request("http://local/v1/templates/preview", {
      method: "POST",
    }),
  } as unknown as RouteContext;
  await assertRejects(async () => await route.handler(context));
  context.request = new Request("http://local/v1/templates/preview", {
    method: "POST",
    headers: { "idempotency-key": "preview" },
  });
  assertEquals((await route.handler(context)).body, {
    ru: "<b>Сбой</b>",
    kk: "Қате",
  });
  context.body.text_ru = "<script>alert(1)</script>";
  await assertRejects(async () => await route.handler(context));
  context.actor = makeTestActor("executor", []);
  await assertRejects(async () => await route.handler(context));
});
