import { assertEquals } from "@std/assert";
import { matchRoute } from "./handlers.ts";
import { FINANCIAL_ROUTES } from "./publication-handlers.ts";
Deno.test("FIN-04: API обязанностей использует эффективную персону и общую маршрутизацию", () => {
  assertEquals(FINANCIAL_ROUTES.length, 8);
  for (const route of FINANCIAL_ROUTES) {
    assertEquals(route.evaluateAs, "effective");
    assertEquals(route.action, "incident.use");
    const path = route.path.replace(":id", "11111111-1111-1111-1111-111111111111");
    assertEquals(matchRoute(route.method, path)?.route.path, route.path);
  }
});
