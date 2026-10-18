import { describe, expect, it } from "vitest";
import {canAcceptTaskReport,type TaskRow} from "./access.ts";
import { can } from "../../pdp/evaluate.ts";
import type { DbExecutor } from "../../db/client.ts";
import { noticeAllowed } from "../notifications/service.ts";
import { STAFF_ROLES } from "../../pdp/types.ts";
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
  it("снятие назначения и отзыв всех служебных ролей закрывают доступ", () => {
    const actor = makeTestActor("executor", [B1], { isTest: true, personId: "worker" });
    expect(can(actor, "task.read", { taskAccess: { ...resource.taskAccess, assigneeId: "other" } }).allow).toBe(false);
    expect(can({ ...actor, assignments: [] }, "task.execute", resource).allow).toBe(false);
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

it.each(STAFF_ROLES)("%s: любой назначенный сотрудник выполняет задание другого дома", (role) => {
  const actor = makeTestActor(role, [B2], { isTest: true, personId: "worker" });
  expect(can(actor, "task.use").allow).toBe(true);
  expect(can(actor, "task.read", resource).allow).toBe(true);
  expect(can(actor, "task.execute", resource).allow).toBe(true);
  expect(can(actor, "task.execute", { taskAccess: { ...resource.taskAccess, assigneeId: "other" } }).allow).toBe(false);
  if (role !== "chairman") expect(can(actor, "task.manage", resource).allow).toBe(false);
});
it("назначение не даёт доступа жителю, архивному сотруднику и к другой тестовой области", () => {
  const actor = makeTestActor("duty", [B2], { isTest: true, personId: "worker" });
  expect(can({ ...actor, assignments: [] }, "task.use").allow).toBe(false);
  expect(can({ ...actor, assignments: [] }, "task.read", resource).allow).toBe(false);
  expect(can({ ...actor, person: { ...actor.person, status: "archived" } }, "task.execute", resource).allow).toBe(false);
  expect(can(actor, "task.read", { taskAccess: { ...resource.taskAccess, isTest: false } }).allow).toBe(false);
});

it("назначение разрешает личное уведомление финансисту другого дома; отзыв или переназначение отменяют доставку", async () => {
  const actor = makeTestActor("finance", [B2], { isTest: true, personId: "worker" });
  const row = { id: "task", building_ids: [B1], assignee_person_id: "worker", is_test: true };
  const exec: DbExecutor = { query: async <T>() => [row as unknown as T] };
  const notice = { taskId: "task", isTest: true, audience: "personal" as const };
  expect(await noticeAllowed(exec, actor, notice)).toBe(true);
  expect(await noticeAllowed(exec, actor, { ...notice, audience: "staff" })).toBe(false);
  expect(await noticeAllowed(exec, { ...actor, assignments: [] }, notice)).toBe(false);
  row.assignee_person_id = "other";
  expect(await noticeAllowed(exec, actor, notice)).toBe(false);
});
