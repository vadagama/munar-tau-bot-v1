import { expect,it } from "vitest";
import { can } from "./evaluate.ts";
import { makeTestActor } from "../testing/actors.ts";
it("операционные панели — сотрудникам своей функции; назначение открывает только своё задание",()=>{
 const worker=makeTestActor("executor",[]),resident={...worker,assignments:[]};expect(can(worker,"report.tasks").allow).toBe(true);expect(can(worker,"report.requests").allow).toBe(false);expect(can(resident,"report.tasks").allow).toBe(false);expect(can(makeTestActor("tech_admin",[]),"report.requests").allow).toBe(false);expect(can(makeTestActor("tech_admin",[]),"report.tasks").allow).toBe(true);
 expect(can(makeTestActor("administrator",[]),"report.requests").allow).toBe(true);expect(can(makeTestActor("deputy",[]),"report.export").allow).toBe(false);expect(can(makeTestActor("chairman",[]),"report.configure").allow).toBe(true);
});
