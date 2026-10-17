import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {TasksPage} from "./tasks";
import {apiFetch} from "../lib/api";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("../lib/identity",()=>({useCabinetIdentity:()=>({identity:{me:{person:{id:"worker"}}},roles:["executor"]})}));
const computed=window.getComputedStyle.bind(window);
beforeEach(()=>{vi.spyOn(window,"getComputedStyle").mockImplementation(el=>computed(el));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
const task={id:"t",number:"ЗД-1",title:"Замена крана",instruction:"Проверить герметичность",due_at:"2026-12-01T12:00:00Z",state:"awaiting_acceptance",version:1,can_execute:true,can_manage:false,log:[]};
it("назначенный исполнитель принимает с версией и ключом; управление скрыто",async()=>{
  vi.mocked(apiFetch).mockImplementation(async (path,opts)=>{
    if(path==="/v1/tasks")return {items:[task]};
    if(path.endsWith("/transitions"))return {...task,state:"accepted",version:2};
    if(path==="/v1/tasks/t")return task;
    throw new Error(`Unexpected ${path} ${opts?.method}`);
  });
  render(<TasksPage/>);
  fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
  fireEvent.click(await screen.findByText("Принять",{selector:"button > span"}));
  const dialog=await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"Принять"}));
  await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith("/v1/tasks/t/transitions",expect.objectContaining({method:"POST",body:{action:"accept",version:1},idempotencyKey:expect.any(String)})));
  expect(screen.queryByText("Создать задание")).toBeNull();
  expect(screen.queryByText("Снять назначение")).toBeNull();
});
it("при отзыве доступа очищает старую карточку",async()=>{
  let deny=false;
  vi.mocked(apiFetch).mockImplementation(async path=>{
    if(path==="/v1/tasks")return {items:[task]};
    if(deny)throw new Error("Задание недоступно");
    return task;
  });
  render(<TasksPage/>);
  fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
  await screen.findByText("Проверить герметичность");deny=true;
  fireEvent.click(screen.getByText("ЗД-1",{selector:"button > span"}));
  await screen.findByText("Задание недоступно");
  expect(screen.queryByText("Проверить герметичность")).toBeNull();
});
it("приёмка требует явного решения по отсутствующему доказательству",async()=>{
 const reviewed={...task,state:"on_review",can_execute:false,can_manage:true,can_approve:true,reports:[{id:"report",version:2,performed_work:"Замена",result:"Течь устранена",limitations:"",evidence:[],missing_evidence:["Фото"]}]};
 vi.mocked(apiFetch).mockImplementation(async(path,opts)=>{
  if(path==="/v1/tasks")return {items:[reviewed]};
  if(opts?.method==="POST")return {...reviewed,state:"accepted_admin"};
  return reviewed;
 });
 render(<TasksPage/>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByText("Принять результат",{selector:"button > span"}));
 const dialog=await screen.findByRole("dialog");
 const submit=within(dialog).getByRole("button",{name:"Принять результат"});
 fireEvent.click(submit);
 await within(dialog).findByText("Подтвердите проверку",{}, {timeout:3000});
 expect(vi.mocked(apiFetch).mock.calls.some(([,opts])=>opts?.method==="POST")).toBe(false);
 fireEvent.click(screen.getByLabelText("Результат и чек-лист проверены"));
 fireEvent.change(screen.getByLabelText("Решение по отсутствующему доказательству: Фото"),{target:{value:"Осмотрено на месте"}});
 fireEvent.click(submit);
 await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith("/v1/tasks/t/transitions",expect.objectContaining({body:expect.objectContaining({report_version:2,result_checked:true,evidence_decisions:[{requirement_id:"Фото",reason:"Осмотрено на месте"}]})})));
});

it("сотрудник с совмещёнными ролями не видит приёмку собственного отчёта",async()=>{
 const own={...task,state:"on_review",can_manage:true,can_approve:false,reports:[]};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[own]}:own);
 render(<TasksPage/>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 expect(screen.queryByRole("button",{name:"Принять результат"})).toBeNull();
 expect(screen.getByRole("button",{name:"Вернуть на доработку"})).toBeInTheDocument();
});
