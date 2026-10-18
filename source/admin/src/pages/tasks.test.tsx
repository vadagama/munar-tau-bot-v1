import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {TasksPage} from "./tasks";
import {apiFetch} from "../lib/api";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("../lib/identity",()=>({useCabinetIdentity:()=>({identity:{me:{person:{id:"worker"}}},roles:["executor"]})}));
const computed=window.getComputedStyle.bind(window);
beforeEach(()=>{localStorage.clear();vi.spyOn(window,"getComputedStyle").mockImplementation(el=>computed(el));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
function enabledButton(container: HTMLElement, name: string) {
 const buttons = within(container).getAllByRole("button", {name})
   .filter(button => !(button as HTMLButtonElement).disabled);
 expect(buttons).toHaveLength(1);
 return buttons[0]!;
}
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
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  const dialog=screen.getByRole("dialog");
  fireEvent.click(enabledButton(dialog,"Принять"));
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
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 const dialog=screen.getByRole("dialog");
 const submit=enabledButton(dialog,"Принять результат");
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

it("доска заданий: состояния в колонках, карточка открывает задание",async()=>{
  vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[task]}:task);
  render(<TasksPage/>);
  fireEvent.click(await screen.findByRole("radio",{name:"Доска"}));
  expect(await screen.findByText("Ожидает принятия")).toBeInTheDocument();
  expect(screen.getByText("Замена крана")).toBeInTheDocument();
  fireEvent.click(screen.getByText("ЗД-1"));
  expect(await screen.findByText("Проверить герметичность")).toBeInTheDocument();
});

it("короткое действие задания остаётся в карточке и отмена возвращает к инструкции",async()=>{
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[task]}:task);
 render(<TasksPage/>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 const drawer=screen.getByRole("dialog");
 fireEvent.click(within(drawer).getByRole("button",{name:"Принять"}));
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 expect(within(drawer).getByText("Проверить герметичность")).toBeInTheDocument();
 fireEvent.click(within(drawer).getByRole("button",{name:"Отмена"}));
 expect(within(drawer).getByRole("button",{name:"Принять"})).toBeInTheDocument();
 expect(vi.mocked(apiFetch).mock.calls.some(([,opts])=>opts?.method==="POST")).toBe(false);
});

it("длинный отчёт открывается в той же шторке и отмена возвращает к заданию",async()=>{
 const inProgress={...task,state:"in_progress"};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[inProgress]}:inProgress);
 render(<TasksPage/>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 const drawer=screen.getByRole("dialog");
 fireEvent.click(within(drawer).getByRole("button",{name:"Отправить отчёт"}));
 await screen.findByLabelText("Выполненный объём");
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 expect(within(drawer).getByLabelText("Выполненный объём")).toBeInTheDocument();
 fireEvent.click(within(drawer).getByRole("button",{name:"Отмена"}));
 expect(within(drawer).queryByLabelText("Выполненный объём")).toBeNull();
 expect(within(drawer).getByText("Проверить герметичность")).toBeInTheDocument();
 expect(vi.mocked(apiFetch).mock.calls.some(([,opts])=>opts?.method==="POST")).toBe(false);
});

it("возврат из шаблона по query открывает задание и сохраняет список под карточкой", async () => {
  window.history.replaceState(null, "", "/tasks?task=t");
  try {
    vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? {items:[task]} : task);
    render(<TasksPage />);
    await screen.findByText("Проверить герметичность");
    expect(await screen.findByRole("button", {name:"ЗД-1"})).toBeInTheDocument();
    expect(window.location.search).toBe("");
  } finally {
    window.history.replaceState(null, "", "/");
  }
});

it("409 обновляет версию задания, сохраняет ввод и требует повторного подтверждения", async () => {
 let reads=0, writes=0;
 vi.mocked(apiFetch).mockImplementation(async (path, options) => {
   if(path==="/v1/tasks") return {items:[task]};
   if(path==="/v1/tasks/t") return {...task,version:++reads===1?1:2};
   if(path==="/v1/tasks/t/transitions" && options?.method==="POST") {
     writes++;
     if(writes===1) throw Object.assign(new Error("Объект изменён"),{status:409});
     return {...task,state:"declined",version:3};
   }
   throw new Error(`Unexpected ${path}`);
 });
 render(<TasksPage />);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByRole("button",{name:"Не могу выполнить"}));
 fireEvent.change(screen.getByLabelText("Причина / основание"),{target:{value:"Нет нужного оборудования"}});
 fireEvent.click(enabledButton(screen.getByRole("dialog"),"Не могу выполнить"));
 await within(screen.getByRole("dialog")).findByText(/Данные обновлены, ваш ввод сохранён/);
 expect(screen.getByLabelText("Причина / основание")).toHaveValue("Нет нужного оборудования");
 expect(writes).toBe(1);
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 fireEvent.click(enabledButton(screen.getByRole("dialog"),"Не могу выполнить"));
 await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith("/v1/tasks/t/transitions",expect.objectContaining({
   body:expect.objectContaining({action:"decline",version:2,reason:"Нет нужного оборудования"})
 })));
});

it("вложенная форма визита использует карточку и защищает введённое описание при отмене", async () => {
 const row={...task,state:"in_progress"};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[row]}:row);
 render(<TasksPage />);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByRole("button",{name:"Предложить визит"}));
 const drawer=screen.getByRole("dialog");
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 fireEvent.change(within(drawer).getByLabelText("Описание визита"),{target:{value:"Проверить кран"}});
 fireEvent.click(within(drawer).getByRole("button",{name:"Отмена"}));
 expect(within(drawer).getByText("Выйти без сохранения введённых данных?")).toBeVisible();
 fireEvent.click(within(drawer).getByRole("button",{name:"Продолжить редактирование"}));
 expect(within(drawer).getByLabelText("Описание визита")).toHaveValue("Проверить кран");
 fireEvent.click(within(drawer).getByRole("button",{name:"Отмена"}));
 fireEvent.click(within(drawer).getByRole("button",{name:"Выйти без сохранения"}));
 expect(within(drawer).queryByLabelText("Описание визита")).toBeNull();
 expect(within(drawer).getByText("Проверить герметичность")).toBeVisible();
});

it("вложенная форма связи найденной проблемы остаётся в карточке и защищает решение от потери", async () => {
 const row={...task,can_manage:true,log:[{id:"problem",meta:{action:"found_problem",location:"Подвал",description:"Найдена течь"}}]};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[row]}:row);
 render(<TasksPage />);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByRole("button",{name:"Связать с заданием"}));
 const field=await screen.findByLabelText("Решение администратора");
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 fireEvent.change(field,{target:{value:"Поручить сантехнику"}});
 fireEvent.click(screen.getByRole("button",{name:"Отмена"}));
 expect(screen.getByText("Выйти без сохранения введённых данных?")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Продолжить редактирование"}));
 expect(field).toHaveValue("Поручить сантехнику");
 fireEvent.click(screen.getByRole("button",{name:"Отмена"}));
 fireEvent.click(screen.getByRole("button",{name:"Выйти без сохранения"}));
 expect(screen.queryByLabelText("Решение администратора")).toBeNull();
 expect(screen.getByText("Найдена течь")).toBeVisible();
});

it("загрузка вариантов найденной проблемы блокирует запуск второго действия карточки", async () => {
 const row={...task,can_manage:true,log:[{id:"problem",meta:{action:"found_problem",location:"Подвал",description:"Найдена течь"}}]};
 let listReads=0;
 let release!: (value:{items:typeof row[]})=>void;
 const delayed=new Promise<{items:typeof row[]}>(resolve=>{release=resolve;});
 vi.mocked(apiFetch).mockImplementation(async path=>{
   if(path==="/v1/tasks") return ++listReads===1?{items:[row]}:delayed;
   return row;
 });
 render(<TasksPage />);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByRole("button",{name:"Связать с заданием"}));
 try {
   expect(screen.getByRole("button",{name:"Не могу выполнить"})).toBeDisabled();
   expect(screen.getAllByRole("dialog")).toHaveLength(1);
 } finally {
   release({items:[row]});
 }
});

it("отзыв доступа при обновлении после действия убирает сохранённую старую карточку", async () => {
 let reads=0;
 vi.mocked(apiFetch).mockImplementation(async (path, options) => {
   if(path==="/v1/tasks") return {items:[task]};
   if(path==="/v1/tasks/t/transitions" && options?.method==="POST") return {...task,state:"accepted",version:2};
   if(path==="/v1/tasks/t") {
     if(++reads===1) return task;
     throw Object.assign(new Error("Доступ к заданию отозван"),{status:403});
   }
   throw new Error(`Unexpected ${path}`);
 });
 render(<TasksPage />);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByText("Принять",{selector:"button > span"}));
 fireEvent.click(enabledButton(screen.getByRole("dialog"),"Принять"));
 await screen.findByText("Доступ к заданию отозван");
 expect(reads).toBe(2); // Первое чтение карточки и ровно одно отказавшее обновление.
 expect(vi.mocked(apiFetch).mock.calls.filter(([path,options])=>path==="/v1/tasks/t/transitions" && options?.method==="POST")).toHaveLength(1);
 await waitFor(()=>expect(screen.queryByText("Проверить герметичность")).toBeNull());
});
