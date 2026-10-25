import { getButton,findButton } from "../test/buttons";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { PollsPage } from "./polls";
import { apiFetch } from "../lib/api";
import type { PollView } from "./poll-types";
const state=vi.hoisted(()=>({identity:"one"}));
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("../lib/identity",()=>({useCabinetIdentity:()=>({roles:["administrator"],identity:{id:state.identity}})}));
const poll:PollView={id:"poll",question:"Когда проводить встречу?",options:[{key:"a",label:"Суббота"},{key:"b",label:"Воскресенье"}],building_ids:["house"],buildings:[{id:"house",label:"Дом 1"}],closes_at:"2026-11-01T10:00:00Z",state:"open",version:4,cancel_reason:null,informational:true,can_manage:true,can_answer:false,can_results:true,deadline_passed:false};
beforeEach(()=>{state.identity="one";});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
it("открытые параметры только читаются; агрегат не содержит персонального состава",async()=>{
  vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/polls"?{items:[poll],has_more:false}:path.endsWith("/results")?{participants_count:2,distribution:[{option_key:"a",count:2},{option_key:"b",count:0}],as_of:poll.closes_at,final:false}:poll);
  render(<PollsPage/>);fireEvent.click(await findButton(poll.question));
  expect(await findButton("Отменить опрос")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Изменить черновик"})).not.toBeInTheDocument();
  expect(await screen.findByText("Ответили: 2")).toBeInTheDocument();
  expect(screen.queryByText("Индивидуальные ответы")).not.toBeInTheDocument();
  expect(screen.queryByText("person_id")).not.toBeInTheDocument();
});
it("отмена передаёт причину/версию и после перечитывания скрывает результаты",async()=>{
  let current={...poll};
  vi.mocked(apiFetch).mockImplementation(async(path,options)=>{
    if(options?.method==="POST"){current={...current,state:"canceled",version:5,cancel_reason:"Вопрос уточняется",can_results:false};return current;}
    return path==="/v1/polls"?{items:[current],has_more:false}:path.endsWith("/results")?{participants_count:0,distribution:[],as_of:poll.closes_at,final:false}:current;
 });
  render(<PollsPage/>);fireEvent.click(await findButton(poll.question));
  fireEvent.click(await findButton("Отменить опрос"));
  fireEvent.change(screen.getByLabelText("Причина отмены"),{target:{value:"Вопрос уточняется"}});
  fireEvent.click(getButton("Подтвердить отмену"));
  await waitFor(()=>expect(vi.mocked(apiFetch).mock.calls.some(([path,options])=>path==="/v1/polls/poll/transitions"&&options?.method==="POST"&&JSON.stringify(options.body).includes('"expected_version":4'))).toBe(true));
  expect(await screen.findByText("Результаты отменённого опроса недоступны")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Обновить результаты"})).not.toBeInTheDocument();
});
it("поздняя карточка прежней персоны не появляется после переключения",async()=>{
  let finish!:(value:unknown)=>void;
  vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/polls"?{items:state.identity==="one"?[poll]:[],has_more:false}:new Promise(resolve=>{finish=resolve;}));
  const view=render(<PollsPage/>);fireEvent.click(await findButton(poll.question));
  state.identity="two";view.rerender(<PollsPage/>);
  await act(async()=>finish(poll));
  expect(screen.queryByRole("button",{name:"Отменить опрос"})).not.toBeInTheDocument();
  expect(screen.queryByText(poll.question)).not.toBeInTheDocument();
});
it("ошибка списка видна; повторная загрузка не записывает данные",async()=>{
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Список недоступен")).mockResolvedValue({items:[],has_more:false});
  render(<PollsPage/>);expect(await screen.findByText("Список недоступен")).toBeInTheDocument();
  fireEvent(window, new Event("cabinet:refresh-page"));
  expect(await screen.findByText("Опросов пока нет")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.every(([,options])=>!options?.method)).toBe(true);
});
it("серверный запрет управления скрывает действия даже при роли администратора",async()=>{
  const readonly={...poll,can_manage:false,can_results:false};
  vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/polls"?{items:[readonly],has_more:false}:readonly);
  render(<PollsPage/>);fireEvent.click(await findButton(poll.question));
  await screen.findByRole("region",{name:"Параметры опроса"});
  expect(screen.queryByRole("button",{name:"Отменить опрос"})).not.toBeInTheDocument();
});
it("истечение срока определяется сервером и скрывает отмену",async()=>{
  const elapsed={...poll,deadline_passed:true,can_results:false};
  vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/polls"?{items:[elapsed],has_more:false}:elapsed);
  render(<PollsPage/>);fireEvent.click(await findButton(poll.question));
  expect(await screen.findByText("Срок ответов истёк. Итоги формируются автоматически.")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Отменить опрос"})).not.toBeInTheDocument();
});

it("завершение фонового списка не открывает прежнюю карточку поверх новой формы",async()=>{
  let finish!:(value:unknown)=>void,lists=0;
  vi.mocked(apiFetch).mockImplementation(async path=>{
    if(path==="/v1/registry/buildings")return {items:[{id:"house",code:"1",name:"Дом 1"}]};
    if(path==="/v1/polls"){if(++lists===2)return new Promise(resolve=>{finish=resolve;});return {items:[poll],has_more:false};}
    return path.endsWith("/results")?{participants_count:0,distribution:[],as_of:poll.closes_at,final:false}:poll;
 });
  render(<PollsPage/>);fireEvent.click(await findButton(poll.question));
  await findButton("Отменить опрос");
  fireEvent(window,new Event("cabinet:refresh-page"));
  fireEvent.click(getButton("Новый опрос"));
  await screen.findByRole("textbox",{name:"Вопрос"});
  await act(async()=>finish({items:[poll],has_more:false}));
  expect(screen.getByRole("textbox",{name:"Вопрос"})).toBeInTheDocument();
});
