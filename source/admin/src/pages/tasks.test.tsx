import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
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
  const buttons=await screen.findAllByText("Принять",{selector:"button > span"});
  fireEvent.click(buttons[buttons.length-1]!);
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
