import { expect,it } from "vitest";
import Workbook from "exceljs/lib/doc/workbook.js";
import { reportWorkbook,exportPermissionSnapshot,checkExportScope } from "./export.ts";
import { makeTestActor,B1,B2 } from "../../testing/actors.ts";
it("Excel содержит только разрешённые колонки, похожий на формулу текст не исполняется",async()=>{
 const bytes=await reportWorkbook("tasks",[{id:"private-id",number:"ЗД-1",title:"=HYPERLINK(\"evil\")",state:"in_progress",assignee_name:"+Имя",due_at:"2026-10-23T10:00:00Z",phone:"+7000000000",instruction:"SECRET",attachments:["hidden"],calendar_minutes:90}],{from:"2026-10-01T00:00:00Z",to:"2026-11-01T00:00:00Z",as_of:"2026-10-24T00:00:00Z"});
 const workbook=new Workbook();await workbook.xlsx.load(bytes as never);const sheet=workbook.getWorksheet("Отчёт")!;expect(sheet.getRow(1).values).toContain("Номер");
 const all=JSON.stringify(sheet.getSheetValues());expect(all).toContain("HYPERLINK");expect(all).not.toMatch(/SECRET|7000000000|private-id|hidden/);
 sheet.eachRow(row=>row.eachCell(cell=>{expect(cell.type).not.toBe(6);expect(cell.value).not.toHaveProperty("formula");}));expect(sheet.getCell(2,2).value).toBe("'=HYPERLINK(\"evil\")");
});
it("потеря части исходной области запрещает весь экспорт; расширение прав не расширяет снимок",()=>{
 const original=makeTestActor("administrator",[B1,B2]),snapshot=exportPermissionSnapshot(original);
 expect(()=>checkExportScope(makeTestActor("administrator",[B1]),snapshot)).toThrow();const current=makeTestActor("chairman",[]),bounded=checkExportScope(current,snapshot);expect(bounded.assignments.some(a=>a.role==="chairman")).toBe(false);expect(bounded.assignments[0]!.scopeBuildingIds).toEqual([B1,B2]);
});
it("председатель после снижения до администратора не получает прежний полный файл",()=>{
 expect(()=>checkExportScope(makeTestActor("administrator",[B1]),exportPermissionSnapshot(makeTestActor("chairman",[])))).toThrow();
});
