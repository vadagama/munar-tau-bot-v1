import { assertEquals } from "@std/assert";
import { matchRoute } from "./handlers.ts";
import { DOCUMENT_ROUTES } from "./document-handlers.ts";
Deno.test("DOC: маршруты находятся общим API и оценивают эффективную персону", () => {
  for (const route of DOCUMENT_ROUTES) {
    assertEquals(route.evaluateAs, "effective");
    assertEquals(route.action, "document.use");
    const path = route.path.replace(":id", "11111111-1111-1111-1111-111111111111").replace(":v", "2");
    assertEquals(matchRoute(route.method, path)?.route.path, route.path);
  }
});
