import { expect,it } from "vitest";
import { configureReportLaunch } from "./config.ts";
import { makeTestActor } from "../../testing/actors.ts";
import type { RegistryDeps } from "../registry/service.ts";
it("дату запуска задаёт только председатель вне эмуляции; некорректная дата и причина запрещены",async()=>{
 const deps={} as RegistryDeps,chair=makeTestActor("chairman",[]),emu={...chair,emulation:{sessionId:"e",realPersonId:"r",realProfileId:"p"}};
 await expect(configureReportLaunch(deps,makeTestActor("administrator",[]),{launched_on:"2026-10-01",reason:"Запуск"},"key")).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(configureReportLaunch(deps,emu,{launched_on:"2026-10-01",reason:"Запуск"},"key")).rejects.toMatchObject({code:"FORBIDDEN"});
 for(const input of [{launched_on:"2026-02-30",reason:"Запуск"},{launched_on:"2026-10-01",reason:""},{launched_on:"2026-10-01",reason:"Запуск",extra:true}])await expect(configureReportLaunch(deps,chair,input,"key")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
});
