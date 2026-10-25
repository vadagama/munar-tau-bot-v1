import { MemoryRouter, useNavigate } from "react-router-dom";
import { act } from "@testing-library/react";
import { PAGE_REFRESH_EVENT } from "../lib/use-page-refresh";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {TasksPage} from "./tasks";
import {apiFetch} from "../lib/api";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
const roleHarness = vi.hoisted(() => ({ roles: ["executor"] }));
vi.mock("../lib/identity",()=>({useCabinetIdentity:()=>({identity:{me:{person:{id:"worker"}}},roles:roleHarness.roles})}));
beforeEach(()=>{roleHarness.roles = ["executor"];localStorage.clear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
function enabledButton(container: HTMLElement, name: string) {
 // The label uniquely identifies a native button. Avoid a full accessible-tree
 // scan and computed styles for every repeated click in the large AntD drawer.
 const buttons = within(container).getAllByText(name, {selector:"button > span"})
   .map(label => label.closest("button")!)
   .filter(button => !button.disabled);
 expect(buttons).toHaveLength(1);
 return buttons[0]!;
}
const task={id:"t",number:"ЗД-1",title:"Замена крана",instruction:"Проверить герметичность",due_at:"2026-12-01T12:00:00Z",state:"awaiting_acceptance",version:1,can_execute:true,can_manage:false,log:[]};
it.each(["executor", "duty", "finance", "doc_reviewer", "tech_admin"])("назначенный %s принимает с версией и ключом; управление скрыто",async(role)=>{
  roleHarness.roles = [role];
  vi.mocked(apiFetch).mockImplementation(async (path,opts)=>{
    if(path==="/v1/tasks")return {items:[task]};
    if(path.endsWith("/transitions"))return {...task,state:"accepted",version:2};
    if(path==="/v1/tasks/t")return task;
    throw new Error(`Unexpected ${path} ${opts?.method}`);
 });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
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
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
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
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
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
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 expect(screen.queryByRole("button",{name:"Принять результат"})).toBeNull();
 expect(screen.getByRole("button",{name:"Вернуть на доработку"})).toBeInTheDocument();
});

it("доска заданий: состояния в колонках, карточка открывает задание",async()=>{
  vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[task]}:task);
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
  fireEvent.click(await screen.findByRole("radio",{name:"Доска"}));
  expect(await screen.findByText("Ожидает принятия")).toBeInTheDocument();
  expect(screen.getByText("Замена крана")).toBeInTheDocument();
  fireEvent.click(screen.getByText("ЗД-1"));
  expect(await screen.findByText("Проверить герметичность")).toBeInTheDocument();
});

it("короткое действие задания остаётся в карточке и отмена возвращает к инструкции",async()=>{
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[task]}:task);
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 const drawer=screen.getByRole("dialog");
 fireEvent.click(within(drawer).getByText("Принять",{selector:"button > span"}));
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 expect(within(drawer).getByText("Проверить герметичность")).toBeInTheDocument();
 fireEvent.click(within(drawer).getByText("Отмена",{selector:"button > span"}));
 expect(within(drawer).getByRole("button",{name:"Принять"})).toBeInTheDocument();
 expect(vi.mocked(apiFetch).mock.calls.some(([,opts])=>opts?.method==="POST")).toBe(false);
});

it("длинный отчёт открывается в той же шторке и отмена возвращает к заданию",async()=>{
 const inProgress={...task,state:"in_progress"};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[inProgress]}:inProgress);
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 const drawer=screen.getByRole("dialog");
 fireEvent.click(within(drawer).getByText("Отправить отчёт",{selector:"button > span"}));
 await screen.findByLabelText("Выполненный объём");
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 expect(within(drawer).getByLabelText("Выполненный объём")).toBeInTheDocument();
 fireEvent.click(within(drawer).getByText("Отмена",{selector:"button > span"}));
 expect(within(drawer).queryByLabelText("Выполненный объём")).toBeNull();
 expect(within(drawer).getByText("Проверить герметичность")).toBeInTheDocument();
 expect(vi.mocked(apiFetch).mock.calls.some(([,opts])=>opts?.method==="POST")).toBe(false);
});

it("возврат из шаблона по query открывает задание и сохраняет список под карточкой", async () => {
  window.history.replaceState(null, "", "/tasks?task=t");
  try {
    vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? {items:[task]} : task);
    render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
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
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByText("Не могу выполнить",{selector:"button > span"}));
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

it("вложенная форма связи найденной проблемы остаётся в карточке и защищает решение от потери", async () => {
 const row={...task,can_manage:true,log:[{id:"problem",meta:{action:"found_problem",location:"Подвал",description:"Найдена течь"}}]};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/tasks"?{items:[row]}:row);
 // rc-motion проходит подготовку через RAF. В jsdom после предыдущих
 // Drawer кадровый цикл может задержаться; даём ему детерминированный таймер.
 vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 0));
 vi.spyOn(window, "cancelAnimationFrame").mockImplementation(handle => window.clearTimeout(handle));
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByText("Связать с заданием",{selector:"button > span"}));
 const field=await screen.findByLabelText("Решение администратора");
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 fireEvent.change(field,{target:{value:"Поручить сантехнику"}});
 fireEvent.click(screen.getByText("Отмена",{selector:"button > span"}));
 await waitFor(() => expect(screen.getByText("Выйти без сохранения?")).toBeInTheDocument());
 fireEvent.click(screen.getByText("Продолжить редактирование",{selector:"button > span"}));
 expect(field).toHaveValue("Поручить сантехнику");
 fireEvent.click(screen.getByText("Отмена",{selector:"button > span"}));
 fireEvent.click(screen.getByText("Выйти без сохранения",{selector:"button > span"}));
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
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByText("Связать с заданием",{selector:"button > span"}));
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
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 fireEvent.click(await screen.findByText("Принять",{selector:"button > span"}));
 fireEvent.click(enabledButton(screen.getByRole("dialog"),"Принять"));
 await screen.findByText("Доступ к заданию отозван");
 expect(reads).toBe(2); // Первое чтение карточки и ровно одно отказавшее обновление.
 expect(vi.mocked(apiFetch).mock.calls.filter(([path,options])=>path==="/v1/tasks/t/transitions" && options?.method==="POST")).toHaveLength(1);
 await waitFor(()=>expect(screen.queryByText("Проверить герметичность")).toBeNull());
});

it("обновление перечитывает список без закрытия карточки", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? { items: [task] } : task);
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText("ЗД-1", { selector: "button > span" }));
  await screen.findByText("Проверить герметичность");
  const before = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/tasks").length;
  await act(async () => { window.dispatchEvent(new Event(PAGE_REFRESH_EVENT)); });
  expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/tasks")).toHaveLength(before + 1);
  expect(screen.getByText("Проверить герметичность")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Обновить" })).toBeNull();
});

it("создание задания доступно до завершения загрузки списка", async () => {
  roleHarness.roles = ["chairman"];
  let resolveList!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (path === "/v1/tasks") return new Promise(resolve => { resolveList = resolve; });
    return { items: [] };
 });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  const create = screen.getByRole("button", { name: "Создать задание" });
  expect(create).toBeEnabled();
  fireEvent.click(create);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await act(async () => { resolveList({ items: [task] }); });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("карточка задания содержит обратную ссылку на доступное обращение", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (path === "/v1/tasks") return { items: [task] };
    return { ...task, linked_request: { id: "r", number: "З-42" } };
 });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText("ЗД-1", { selector: "button > span" }));
  expect(await screen.findByRole("link", { name: "З-42" })).toHaveAttribute("href", "/requests?request=r");
});

it("исполнитель виден в таблице и подписан на доске, отсутствие назначения явно указано", async () => {
  const assigned = { ...task, assignee_person_id: "worker", assignee_name: "Мастер ОСИ" };
  const unassigned = { ...task, id: "t2", number: "ЗД-2", assignee_person_id: null, assignee_name: null };
  vi.mocked(apiFetch).mockResolvedValue({ items: [assigned, unassigned] });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  expect(await screen.findByRole("columnheader", { name: "Исполнитель" })).toBeInTheDocument();
  expect(await screen.findByRole("cell", { name: "Мастер ОСИ" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Не назначен" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Доска" }));
  expect(await screen.findByText("Исполнитель: Мастер ОСИ")).toBeInTheDocument();
  expect(screen.getByText("Исполнитель: не назначен")).toBeInTheDocument();
});

it("фильтр исполнителя работает в таблице и на доске, поддерживает отсутствие назначения и сброс", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [
    { ...task, assignee_person_id: "worker", assignee_name: "Мастер ОСИ" },
    { ...task, id: "t2", number: "ЗД-2", assignee_person_id: "other", assignee_name: "Другой мастер" },
    { ...task, id: "t3", number: "ЗД-3", assignee_person_id: null, assignee_name: null },
  ] });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  await screen.findByText("ЗД-3", { selector: "button > span" });
  const filter = screen.getByRole("combobox", { name: "Фильтр по исполнителю" });
  fireEvent.mouseDown(filter);
  fireEvent.click(await screen.findByText("Мастер ОСИ", { selector: ".ant-select-item-option-content" }));
  expect(screen.getByText("ЗД-1", { selector: "button > span" })).toBeInTheDocument();
  expect(screen.queryByText("ЗД-2", { selector: "button > span" })).not.toBeInTheDocument();
  expect(screen.queryByText("ЗД-3", { selector: "button > span" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Доска" }));
  expect(await screen.findByText("ЗД-1")).toBeInTheDocument();
  expect(screen.queryByText("ЗД-2")).not.toBeInTheDocument();
  fireEvent.mouseDown(filter);
  fireEvent.click(await screen.findByText("Без исполнителя", { selector: ".ant-select-item-option-content" }));
  expect(screen.getByText("ЗД-3")).toBeInTheDocument();
  expect(screen.queryByText("ЗД-1")).not.toBeInTheDocument();
  fireEvent.mouseDown(filter.closest(".ant-select")!.querySelector(".ant-select-clear")!);
  expect(screen.getByText("ЗД-1")).toBeInTheDocument();
  expect(screen.getByText("ЗД-2")).toBeInTheDocument();
  expect(screen.getByText("ЗД-3")).toBeInTheDocument();
});

it("поиск, состояние и даты создания совместно фильтруют таблицу и доску", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [
    { ...task, id: "a", number: "ЗД-100", title: "Кран", instruction: "Устранить течь", created_at: "2026-10-20T19:00:00Z" },
    { ...task, id: "b", number: "ЗД-101", title: "Кран", instruction: "Устранить течь", created_at: "2026-10-21T18:59:59.999Z", state: "accepted" },
    { ...task, id: "c", number: "ЗД-102", title: "Кран", instruction: "Устранить течь", created_at: "2026-10-21T19:00:00Z" },
  ] });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  await screen.findByText("ЗД-100", { selector: "button > span" });
  fireEvent.change(screen.getByLabelText("Поиск заданий"), { target: { value: "течь" } });
  fireEvent.change(screen.getByLabelText("Дата создания с"), { target: { value: "2026-10-21" } });
  fireEvent.change(screen.getByLabelText("Дата создания по"), { target: { value: "2026-10-21" } });
  expect(screen.getByText("ЗД-100", { selector: "button > span" })).toBeInTheDocument();
  expect(screen.getByText("ЗД-101", { selector: "button > span" })).toBeInTheDocument();
  expect(screen.queryByText("ЗД-102", { selector: "button > span" })).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Состояние задания" }));
  fireEvent.click(await screen.findByText("Принято", { selector: ".ant-select-item-option-content" }));
  expect(screen.queryByText("ЗД-100", { selector: "button > span" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Доска" }));
  expect(screen.getByText("ЗД-101")).toBeInTheDocument();
  expect(screen.queryByText("ЗД-100")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Поиск заданий"), { target: { value: "ЗД-101" } });
  expect(screen.getByText("ЗД-101")).toBeInTheDocument();
});

it("колонка обращения показывает только разрешённую сервером ссылку", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ items: [
    { ...task, linked_request: { id: "r", number: "З-26-42" } },
    { ...task, id: "t2", number: "ЗД-2", request_id: "hidden", linked_request: null },
  ] });
  render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage /></MemoryRouter>);
  expect(await screen.findByText("З-26-42", {selector:"a"})).toHaveAttribute("href", "/requests?request=r");
  fireEvent.click(screen.getByLabelText("Колонки", {selector:"button"}));
  const settings = await screen.findByLabelText("Видимые колонки", {selector:'[role="group"]'});
  const table = screen.getByText("З-26-42", {selector:"a"}).closest("table")!;
  fireEvent.click(within(settings).getByLabelText("Обращение", {selector:"input"}));
  expect(within(table).queryByText("Обращение", {selector:"th, th *"})).not.toBeInTheDocument();
});

it("показывает только последнюю ошибку доставки вверху карточки задания", async () => {
 const card = {...task, delivery_failures: [
  {id:"latest",last_error:"BLOCKED_BY_USER",followup_state:"done"},
  {id:"older",last_error:"DISPATCH_FAILED",followup_state:"pending"},
  {id:"oldest",last_error:"UNKNOWN",followup_state:"pending"},
 ]};
 vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? {items:[card]} : card);
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1", {selector:"button > span"}));
 const instruction = await screen.findByText("Проверить герметичность");
 const notice = screen.getByRole("alert", {name:"Ошибка доставки уведомления"});
 expect(within(screen.getByRole("dialog")).getAllByRole("alert")).toHaveLength(1);
 expect(within(notice).getByText("Бот заблокирован получателем")).toBeInTheDocument();
 expect(within(notice).getByText(/результат записан/)).toBeInTheDocument();
 expect(screen.queryByText("Не удалось подготовить уведомление")).toBeNull();
 expect(screen.queryByText("Доставка не удалась")).toBeNull();
 expect(notice.compareDocumentPosition(instruction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("не показывает ошибку доставки при пустом списке уведомлений", async () => {
 const card = {...task,delivery_failures:[]};
 vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? {items:[card]} : card);
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1", {selector:"button > span"}));
 await screen.findByText("Проверить герметичность");
 expect(screen.queryByRole("alert", {name:"Ошибка доставки уведомления"})).toBeNull();
});

it("при проверке сначала показывает отчёт и решение, затем инструкцию", async () => {
 const card = {...task,state:"on_review",can_execute:false,can_manage:true,can_approve:true,reports:[{version:1,performed_work:"Первый отчёт",result:"Требовал исправлений",evidence:[]},{version:2,performed_work:"Проверено",result:"Течь устранена",evidence:[]}]};
 vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? {items:[card]} : card);
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 const report=await screen.findByRole("region",{name:"Отчёты"});
 const information=screen.getByRole("region",{name:"Информация о задании"});
 expect(report.compareDocumentPosition(information) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(within(report).getByText(/Первый отчёт/).closest("details")).not.toHaveAttribute("open");
 expect(within(report).getByText(/Текущий отчёт · версия/)).toHaveTextContent("2");
 expect(within(report).getByRole("button",{name:"Принять результат"})).toHaveClass("ant-btn-primary");
 expect(screen.getByRole("region",{name:"Сейчас по процессу"})).toHaveTextContent("Нужно проверить отчёт");
 expect(screen.getByText("Показать историю").closest("details")).not.toHaveAttribute("open");
});

it("управляющему показывает ожидание принятия без действия вместо исполнителя", async () => {
 const card={...task,can_execute:false,can_manage:true,assignee_name:"Мастер"};
 vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks" ? {items:[card]} : card);
 render(<MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><TasksPage/></MemoryRouter>);
 fireEvent.click(await screen.findByText("ЗД-1",{selector:"button > span"}));
 const process=await screen.findByRole("region",{name:"Сейчас по процессу"});
 expect(process).toHaveTextContent("Ожидаем принятия задания");
 expect(within(process).queryByRole("button",{name:"Принять"})).toBeNull();
 expect(within(process).queryByRole("button",{name:"Другие действия"})).toBeNull();
 expect(within(process).getByRole("button",{name:"Отменить"})).toBeVisible();
});

function HistoryBack() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Назад в истории</button>; }
it("карточка-страница задания восстанавливается кнопкой браузера Назад", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/tasks/t" ? task : { items: path === "/v1/tasks" ? [task] : [] });
  render(<MemoryRouter initialEntries={["/tasks?task=t&entity_page=1"]}><HistoryBack /><TasksPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "К списку" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "К списку" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Назад в истории" }));
  expect(await screen.findByRole("button", { name: "К списку" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
