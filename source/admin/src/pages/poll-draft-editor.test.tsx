import { getButton,findButton } from "../test/buttons";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { PollDraftEditor } from "./poll-draft-editor";
import { apiFetch } from "../lib/api";
import type { PollView } from "./poll-types";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
const computed=window.getComputedStyle.bind(window);
const poll:PollView={id:"poll",question:"Старый вопрос",options:[{key:"stable_a",label:"Да"},{key:"stable_b",label:"Нет"}],building_ids:["house"],buildings:[{id:"house",label:"Дом 1"}],closes_at:"2026-11-01T10:00:00Z",state:"draft",version:1,cancel_reason:null,informational:true,can_manage:true,can_answer:false,can_results:false,deadline_passed:false};
beforeEach(()=>{vi.spyOn(window,"getComputedStyle").mockImplementation(element=>computed(element));});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
async function ready(){await waitFor(()=>expect(getButton("Сохранить черновик")).toBeEnabled());}
const writes=()=>vi.mocked(apiFetch).mock.calls.filter(([,options])=>options?.method==="PATCH");
it("повтор того же намерения сохраняет ключ; изменение тела создаёт новый, варианты и ввод сохраняются",async()=>{
  vi.mocked(apiFetch).mockImplementation(async(_path,options)=>{if(options?.method)throw new Error("Сеть оборвалась");return {items:[{id:"house",code:"1",name:"Дом 1"}]};});
  render(<PollDraftEditor poll={poll} onCancel={vi.fn()} onSaved={vi.fn()}/>);await ready();
  fireEvent.change(screen.getByLabelText("Причина сохранения"),{target:{value:"Уточняю формулировку"}});
  const save=getButton("Сохранить черновик");
  fireEvent.click(save);await waitFor(()=>expect(writes()).toHaveLength(1));await ready();
  fireEvent.click(save);await waitFor(()=>expect(writes()).toHaveLength(2));await ready();
  expect(writes()[0]?.[1]?.idempotencyKey).toBe(writes()[1]?.[1]?.idempotencyKey);
  fireEvent.change(screen.getByLabelText("Вопрос"),{target:{value:"Другой вопрос"}});
  fireEvent.click(save);await waitFor(()=>expect(writes()).toHaveLength(3));await ready();
  expect(writes()[2]?.[1]?.idempotencyKey).not.toBe(writes()[1]?.[1]?.idempotencyKey);
  expect(writes()[2]?.[1]?.body).toMatchObject({question:"Другой вопрос",expected_version:1,closes_at:poll.closes_at.replace("Z",".000Z"),options:poll.options});
  expect(screen.getByLabelText("Причина сохранения")).toHaveValue("Уточняю формулировку");
});
it("409 блокирует запись до перечитывания и сравнения, сохраняя форму",async()=>{
  const saved=vi.fn();let attempt=0;
  vi.mocked(apiFetch).mockImplementation(async(path,options)=>{
    if(options?.method){attempt++;if(attempt===1)throw Object.assign(new Error("Версия изменилась"),{status:409});return poll;}
    return path==="/v1/registry/buildings"?{items:[{id:"house",code:"1",name:"Дом 1"}]}:{...poll,version:2,question:"Сохранённый вопрос"};
  });
  render(<PollDraftEditor poll={poll} onCancel={vi.fn()} onSaved={saved}/>);await ready();
  fireEvent.change(screen.getByLabelText("Вопрос"),{target:{value:"Мой новый вопрос"}});
  fireEvent.change(screen.getByLabelText("Причина сохранения"),{target:{value:"Уточнение"}});
  fireEvent.click(getButton("Сохранить черновик"));
  expect(await findButton("Загрузить актуальную карточку")).toBeInTheDocument();
  expect(getButton("Сохранить черновик")).toBeDisabled();
  fireEvent.click(getButton("Загрузить актуальную карточку"));
  expect(await screen.findByText("Сохранённый вопрос")).toBeInTheDocument();await ready();
  expect(screen.getByLabelText("Вопрос")).toHaveValue("Мой новый вопрос");
  fireEvent.click(getButton("Сохранить черновик"));
  await waitFor(()=>expect(saved).toHaveBeenCalledWith("poll"));
  expect(writes()[1]?.[1]?.body).toMatchObject({question:"Мой новый вопрос",expected_version:2});
});
it("открытый другим сотрудником черновик не отправляется повторно после 409",async()=>{
  vi.mocked(apiFetch).mockImplementation(async(path,options)=>{if(options?.method)throw Object.assign(new Error("Конфликт"),{status:409});return path==="/v1/registry/buildings"?{items:[{id:"house",code:"1",name:"Дом 1"}]}:{...poll,state:"open",version:2};});
  render(<PollDraftEditor poll={poll} onCancel={vi.fn()} onSaved={vi.fn()}/>);await ready();
  fireEvent.change(screen.getByLabelText("Причина сохранения"),{target:{value:"Правка"}});
  fireEvent.click(getButton("Сохранить черновик"));
  fireEvent.click(await findButton("Загрузить актуальную карточку"));
  expect(await screen.findByText("Черновик больше недоступен для изменения. Ваш ввод сохранён.")).toBeInTheDocument();
  expect(getButton("Сохранить черновик")).toBeDisabled();expect(writes()).toHaveLength(1);
});
