import { act,cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { ReportsPage } from "./reports";
import { apiFetch } from "../lib/api";
const state=vi.hoisted(()=>({identity:"one",roles:["administrator"]}));
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("../lib/identity",()=>({useCabinetIdentity:()=>({roles:state.roles,identity:{id:state.identity}})}));
const result={kind:"requests",available:true,is_test:false,as_of:"2026-10-24T00:00:00Z",period:{from:"2026-10-01T00:00:00Z",to:"2026-11-01T00:00:00Z",timezone:"Asia/Almaty"},filter_options:{buildings:[],assignees:[]},flows:{received:3,completed:1},snapshot:{open:2,overdue:0,unknown:0},sample_sizes:{registered:3,unknown_response:1},durations:{first_response:{calendar:{mean:15,median:10,n:2},working:{mean:null,median:null,n:0}}},items:[{id:"r1",number:"З-42",state:"new",category:"Двор",calendar_minutes:15}],total:1,has_more:false};
const computed=window.getComputedStyle.bind(window);
beforeEach(()=>{state.identity="one";state.roles=["administrator"];vi.spyOn(window,"getComputedStyle").mockImplementation(e=>computed(e));});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
it("разделяет поток, снимок, длительности и неизвестные данные; переход ведёт в карточку",async()=>{
 vi.mocked(apiFetch).mockResolvedValue(result);render(<ReportsPage/>);expect(await screen.findByRole("link",{name:"З-42"})).toHaveAttribute("href","/requests?request=r1");expect(screen.getByText("Поток за период")).toBeInTheDocument();expect(screen.getByText("Снимок на дату")).toBeInTheDocument();expect(screen.getByText(/Рабочая длительность: Нет данных \(n=0\)/)).toBeInTheDocument();
});
it("исполнитель видит свою работу, без управленческих вкладок и экспорта",async()=>{
 state.roles=["executor"];vi.mocked(apiFetch).mockResolvedValue({...result,kind:"tasks",items:[]});render(<ReportsPage/>);await screen.findByText("Поток за период");expect(apiFetch).toHaveBeenCalledWith("/v1/reports/tasks",expect.anything());expect(screen.queryByRole("button",{name:"Создать Excel"})).not.toBeInTheDocument();expect(screen.queryByRole("tab",{name:"Обращения"})).not.toBeInTheDocument();
});
it("поздний ответ прежней персоны не раскрывается",async()=>{
 let finish!:(value:unknown)=>void;vi.mocked(apiFetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({...result,items:[],flows:{received:0}});const view=render(<ReportsPage/>);state.identity="two";view.rerender(<ReportsPage/>);await act(async()=>finish(result));expect(screen.queryByRole("link",{name:"З-42"})).not.toBeInTheDocument();
});
it("недоступность VS-6 не отображает фиктивные финансовые нули",async()=>{
 vi.mocked(apiFetch).mockImplementation(async path=>path.endsWith("payments")?{available:false,reason:"VS6_SOURCE_UNAVAILABLE"}:result);render(<ReportsPage/>);await screen.findByText("Поток за период");fireEvent.click(screen.getByRole("tab",{name:"Финансы"}));expect(await screen.findByText(/Финансовый источник VS-6 пока недоступен/)).toBeInTheDocument();expect(screen.queryByText("Поток за период")).not.toBeInTheDocument();
});
it("экспорт сохраняет намерение и скрывает ссылку при отзыве доступа",async()=>{
 const job={id:"job1",kind:"requests",state:"pending",as_of:result.as_of,filters:{from:"2026-10-01",to:"2026-11-01"}};let revoke=false;
 vi.mocked(apiFetch).mockImplementation(async path=>{if(path==="/v1/reports/export")return job;if(path.endsWith("/url"))return {url:"https://private.test/download"};if(path.includes("/exports/")){if(revoke)throw new Error("Доступ отозван");return {...job,state:"ready"};}return result;});
 render(<ReportsPage/>);await screen.findByText("Поток за период");fireEvent.click(screen.getByRole("button",{name:"Создать Excel"}));await screen.findByText("В очереди");fireEvent.click(screen.getByRole("button",{name:"Проверить экспорт"}));fireEvent.click(await screen.findByRole("button",{name:"Получить ссылку"}));expect(await screen.findByRole("link",{name:"Скачать файл"})).toHaveAttribute("href","https://private.test/download");
 revoke=true;fireEvent.click(screen.getByRole("button",{name:"Проверить экспорт"}));await screen.findByText("Доступ отозван");expect(screen.queryByRole("link",{name:"Скачать файл"})).not.toBeInTheDocument();
});
it("сохранение KPI после смены периода обновляет актуальный фильтр",async()=>{
 state.roles=["chairman"];let finish!:(value:unknown)=>void;
 vi.mocked(apiFetch).mockImplementation(async(path,options)=>path==="/v1/reports/launch"?new Promise(resolve=>{finish=resolve;}):{...result,items:options?.query?.from==="2026-09-01"?[]:result.items});
 render(<ReportsPage/>);await screen.findByText("Поток за период");fireEvent.change(screen.getByLabelText("Дата запуска KPI"),{target:{value:"2026-10-01"}});fireEvent.change(screen.getByLabelText("Причина настройки KPI"),{target:{value:"Запуск"}});fireEvent.click(screen.getByRole("button",{name:"Сохранить дату запуска"}));
 fireEvent.change(screen.getByLabelText("Начало периода"),{target:{value:"2026-09-01"}});await screen.findByText("Объектов за выбранный период нет");await act(async()=>finish({}));
 const gets=vi.mocked(apiFetch).mock.calls.filter(([path])=>path==="/v1/reports/requests");expect(gets.at(-1)?.[1]?.query?.from).toBe("2026-09-01");expect(screen.queryByRole("link",{name:"З-42"})).not.toBeInTheDocument();
});
