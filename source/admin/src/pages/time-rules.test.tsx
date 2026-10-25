import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {TimeRulesPage} from "./time-rules";
import {apiFetch} from "../lib/api";
import {ruleContract} from "../../../core/src/domains/timing/contracts";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
const computed=window.getComputedStyle.bind(window);
beforeEach(()=>{vi.spyOn(window,"getComputedStyle").mockImplementation(element=>computed(element));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
it("FIN-04: ненастроенные сроки финансовых отчётов имеют понятные названия",async()=>{
 vi.mocked(apiFetch).mockResolvedValue({items:["financial_monthly_publication","financial_annual_publication"].map(key=>({id:null,key,version:null,params:null,contract:ruleContract(key)}))});
 render(<TimeRulesPage/>);
 expect(await screen.findByText("Размещение месячного финансового отчёта")).toBeInTheDocument();
 expect(screen.getByText("Размещение годового финансового отчёта")).toBeInTheDocument();
 expect(screen.getAllByText(/Не настроен/)).toHaveLength(2);
});
it("TIM-02: условия видны, новая длительность не отправляет клиентский контракт",async()=>{
 const contract=ruleContract("author_reminder");
 vi.mocked(apiFetch).mockResolvedValue({items:[{id:"rule",key:"author_reminder",version:2,kind:"operational",created_at:"2026-10-17T10:00:00Z",params:{hours:48,clock:"calendar",contract},contract}]});
 render(<TimeRulesPage/>);
 await screen.findByText("Напоминание автору");
 fireEvent.click(screen.getByRole("button",{name:"Напоминание автору"}));
 expect(await screen.findByText(/Начало: Передача конкретной версии/)).toBeInTheDocument();
 expect(screen.getAllByText(/Напомнить автору без автоматического закрытия/).length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole("button",{name:"Новая версия"}));
 fireEvent.change(screen.getByLabelText("Причина изменения"),{target:{value:"Изменение срока"}});
 fireEvent.click(screen.getByRole("button",{name:"Сохранить версию"}));
 await waitFor(()=>expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==="POST")).toBe(true));
 const [,options]=vi.mocked(apiFetch).mock.calls.find(([,o])=>o?.method==="POST")!;
 expect(options?.body).toMatchObject({params:{hours:48,clock:"calendar"},reason:"Изменение срока"});
 expect((options?.body as {params:object}).params).not.toHaveProperty("contract");
},15000);

it("ненастроенный регламент не показывает фиктивную историю",async()=>{
 vi.mocked(apiFetch).mockResolvedValue({items:[{id:null,key:"task_accept",version:null,params:null,contract:ruleContract("task_accept")}]});
 render(<TimeRulesPage/>);
 await screen.findByText("Ожидание принятия задания");
 fireEvent.click(screen.getByRole("button",{name:"Ожидание принятия задания"}));
 expect(await screen.findByText(/Начало: Направление нового назначения/)).toBeInTheDocument();
 expect(screen.getByText("Не настроен")).toBeInTheDocument();
 expect(screen.queryByText(/Invalid Date|Начальная настройка/)).not.toBeInTheDocument();
});

it("TIM: переход к общему графику сохраняет черновик правила", async () => {
 vi.mocked(apiFetch).mockResolvedValue({items:[
  {id:"rule",key:"dispute_total",version:1,params:{hours:36,clock:"working"}},
  {id:"schedule",key:"work_schedule",version:1,params:{hours:0,clock:"calendar",start:8,end:20,timezone:"Asia/Almaty",days:[1,2,3,4,5]}},
 ]});
 render(<TimeRulesPage/>);
 await screen.findByText("Общий срок спора");
 fireEvent.click(screen.getAllByRole("button",{name:"Новая версия"})[0]!);
 fireEvent.change(screen.getByLabelText("Причина изменения"),{target:{value:"Черновик причины"}});
 fireEvent.click(screen.getByRole("button",{name:"Открыть общий график"}));
 await waitFor(() => expect(screen.getByRole("dialog",{name:"Рабочий график"})).toBeVisible());
 expect(screen.getByLabelText("Открытие, час")).toBeEnabled();
 expect(screen.getByLabelText("Часовой пояс")).toBeEnabled();
 fireEvent.click(screen.getByRole("button",{name:"Отмена"}));
 await waitFor(() => expect(screen.getByRole("dialog",{name:"Общий срок спора"})).toBeVisible());
 expect(screen.getByLabelText("Причина изменения")).toHaveValue("Черновик причины");
 expect(vi.mocked(apiFetch).mock.calls.some(([,o]) => o?.method === "POST")).toBe(false);
},15000);
