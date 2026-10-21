import { expect, it, vi } from "vitest";
import { replyText } from "./keyboard.ts";
import { incidentStep } from "./incidents.ts";
import { queueBroadcast } from "../domains/incidents/broadcast.ts";
import { B1, makeTestActor } from "../testing/actors.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbExecutor } from "../db/client.ts";
vi.mock(
  "../domains/incidents/service.ts",
  () => ({
    listIncidents:
      async () => [{ number: "АВ-1", title: "<b>Вода & свет</b>" }],
  }),
);
it("команды VS-7 экранируют пользовательский текст для нового HTML-транспорта", async () => {
  expect(
    replyText(await incidentStep(
      {db:{query:async()=>[]}} as unknown as RegistryDeps,
      "123",
      "/incidents",
      makeTestActor("administrator", [B1]),
    )),
  ).toBe("АВ-1: &lt;b&gt;Вода &amp; свет&lt;/b&gt;");
});
it("рассылка сохраняет безопасный текст обоих языков до разбиения на части", async () => {
  let saved: unknown;
  const db: DbExecutor = {
    query: async <T>(_sql: string, params?: readonly unknown[]) => {
      saved = JSON.parse(String(params?.[2]));
      return [] as T[];
    },
  };
  await queueBroadcast(db, {
    key: "test",
    type: "incident",
    text: { ru: "<b>Течь</b>", kk: "Су & жылу" },
    scope: [],
    isTest: true,
  });
  expect(saved).toEqual({ ru: "&lt;b&gt;Течь&lt;/b&gt;", kk: "Су &amp; жылу" });
});
it('HTML переопределения инцидентов не экранируется повторно',async()=>{
 const deps={db:{query:async()=>[]},templates:new Map([['incidents.opasnost_avariya_napishite_emergency_nomer_obrascheniya_chto',{ru:'<b>Дежурный</b>',kk:'<b>Кезекші</b>'}]])} as unknown as RegistryDeps;
 expect(await incidentStep(deps,'123','/emergency',makeTestActor('administrator',[B1]))).toBe('<b>Дежурный</b>');
});
