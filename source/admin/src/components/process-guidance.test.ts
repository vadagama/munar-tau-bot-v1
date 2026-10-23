import { describe, expect, it } from "vitest";
import { requestGuidance, taskGuidance, incidentGuidance, publicationGuidance, processActionHint } from "./process-guidance";

describe("подсказки процесса", () => {
 it("на рассмотрении предлагает начать работу для заявки и вопроса", () => {
  expect(requestGuidance({state:"reviewing",kind:"request"},true,false).primary).toBe("start_work");
  expect(requestGuidance({state:"reviewing",kind:"question"},true,false).primary).toBe("start_work");
 });
 it("при невыполненном обязательном задании не предлагает итоговый ответ", () => {
  const g=requestGuidance({state:"in_work",tasks:[{state:"in_progress",is_required:true}]},true,false);
  expect(g.primary).toBeUndefined(); expect(g.description).toContain("1");
 });
 it("житель подтверждает результат, управляющий ожидает жителя", () => {
  expect(requestGuidance({state:"awaiting_confirmation"},false,true).primary).toBe("confirm_result");
  expect(requestGuidance({state:"awaiting_confirmation"},true,false).primary).toBeUndefined();
 });
 it("управляющий не начинает задание вместо исполнителя", () => {
  expect(taskGuidance({state:"accepted",can_manage:true}).primary).toBeUndefined();
  expect(taskGuidance({state:"accepted",can_execute:true}).primary).toBe("start");
 });
 it("собственный отчёт не получает действие приёмки", () => {
  expect(taskGuidance({state:"on_review",can_manage:true,can_approve:false}).primary).toBeUndefined();
  expect(taskGuidance({state:"on_review",can_manage:true,can_approve:true}).primary).toBe("approve");
 });
 it("авария выбирает только существующий серверный переход", () => {
  expect(incidentGuidance({state:"recovery_check",actions:["fail_check"]}).primary).toBeUndefined();
  expect(incidentGuidance({state:"recovery_check",actions:["complete"]}).primary).toBe("complete");
 });
 it("финансовый отчёт ожидает председателя", () => {
  expect(publicationGuidance({state:"pending_approval"},true,false).primary).toBeUndefined();
  expect(publicationGuidance({state:"pending_approval"},true,true).primary).toBe("approve");
 });
 it("после согласования финансового отчёта предлагает публикацию", () => {
  expect(publicationGuidance({state:"draft",kind:"financial_report",approved_by:"chairman"},true,false).primary).toBe("publish");
  expect(publicationGuidance({state:"draft",kind:"financial_report",approved_by:null},true,false).primary).toBe("submit_approval");
 });
 it("исполнитель ожидает проверку, житель — рассмотрение ОСИ", () => {
  expect(taskGuidance({state:"on_review",can_execute:true}).title).toBe("Отчёт отправлен на проверку");
  expect(requestGuidance({state:"reviewing",kind:"request"},false,true).title).toBe("Обращение на рассмотрении");
 });
 it("подтверждение объясняет последствия без автоматической приёмки обращения", () => {
  expect(processActionHint("task","approve")).toContain("обращение закрывается отдельно");
  expect(processActionHint("request","start_work")).toContain("должен отдельно принять");
  expect(processActionHint("incident","unknown")).toBeUndefined();
 });
 it("неизвестное состояние не получает выдуманное действие", () => {
  expect(taskGuidance({state:"future",can_execute:true}).primary).toBeUndefined();
  expect(requestGuidance({state:"future"},true,false).primary).toBeUndefined();
 });
});
