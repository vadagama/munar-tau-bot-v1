import { describe, expect, it } from "vitest";
import {canAcceptTaskReport,type TaskRow} from "./access.ts";
import { can } from "../../pdp/evaluate.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
const resource = { taskAccess: { buildingIds: [B1], assigneeId: "worker", isTest: true } };
describe("VS-4 PDP задания", () => {
  it("назначенный исполнитель читает и выполняет своё задание в области", () => {
    const actor = makeTestActor("executor", [B1], { isTest: true, personId: "worker" });
    expect(can(actor, "task.read", resource).allow).toBe(true);
    expect(can(actor, "task.execute", resource).allow).toBe(true);
    expect(can(actor, "task.manage", resource).allow).toBe(false);
    expect(can(actor, "request.read").allow).toBe(false);
  });
  it("снятие назначения, отзыв роли и чужая область закрывают доступ", () => {
    const actor = makeTestActor("executor", [B1], { isTest: true, personId: "worker" });
    expect(can(actor, "task.read", { taskAccess: { ...resource.taskAccess, assigneeId: "other" } }).allow).toBe(false);
    expect(can({ ...actor, assignments: [] }, "task.execute", resource).allow).toBe(false);
    expect(can(makeTestActor("executor", [B2], { isTest: true, personId: "worker" }), "task.read", resource).allow).toBe(false);
  });
  it("администратор ограничен всей областью общей работы; техадмин не получает бизнес-доступ", () => {
    const actor = makeTestActor("administrator", [B1], { isTest: true });
    expect(can(actor, "task.manage", resource).allow).toBe(true);
    expect(can(actor, "task.manage", { taskAccess: { ...resource.taskAccess, buildingIds: [B1, B2] } }).allow).toBe(false);
    expect(can(makeTestActor("tech_admin", [], { isTest: true }), "task.read", resource).allow).toBe(false);
  });
  it("тестовые данные отделены даже для председателя", () => {
    expect(can(makeTestActor("chairman", [], { isTest: false }), "task.manage", resource).allow).toBe(false);
    expect(can(makeTestActor("chairman", [], { isTest: true }), "task.manage", resource).allow).toBe(true);
  });
});

it("ROL-02d: собственный отчёт нельзя принять даже после смены назначения",()=>{
 const row={state:"on_review",building_ids:[B1],is_test:true,assignee_person_id:"worker"} as TaskRow;
 const chairman=makeTestActor("chairman",[],{isTest:true,personId:"worker"});
 expect(canAcceptTaskReport(chairman,row,"worker")).toBe(false);
 expect(canAcceptTaskReport(chairman,{...row,assignee_person_id:"other"},"worker")).toBe(false);
 expect(canAcceptTaskReport(makeTestActor("administrator",[B1],{isTest:true,personId:"admin"}),row,"worker")).toBe(true);
 expect(canAcceptTaskReport(makeTestActor("executor",[B1],{isTest:true,personId:"other"}),row,"worker")).toBe(false);
});
