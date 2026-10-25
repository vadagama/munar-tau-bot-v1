import { getButton,findButton } from "../test/buttons";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { InitiativesPage } from "./initiatives";
import { apiFetch } from "../lib/api";
const state=vi.hoisted(()=>({identity:"one"}));
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("../lib/identity",()=>({useCabinetIdentity:()=>({roles:["administrator"],identity:{id:state.identity}})}));
const item={id:"item",title:"Освещение двора",body:"Новые светильники",location_text:"Двор",publication_state:"published",stage:"collecting",version:2,requested_building_ids:["house"],approved_building_ids:["house"],can_manage:true,can_moderate:true,can_comment:false,can_support:false,support_count:3,own_support:{version:0,supported:false},owner_decision_required:false};
beforeEach(()=>{state.identity="one";});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
function mock(){vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/initiatives"?{items:[item],has_more:false}:path.endsWith("/comments")||path.endsWith("/history")||path.includes("/moderation/")?{items:[],has_more:false}:item);}
it("карточка показывает этап, поддержку и историю без персонального состава",async()=>{
 mock();render(<InitiativesPage/>);fireEvent.click(await findButton(item.title));
 expect(await screen.findByText("Поддержали: 3")).toBeInTheDocument();expect(await findButton("Оценка")).toBeInTheDocument();
 expect(screen.queryByText("Телефон")).not.toBeInTheDocument();expect(screen.queryByRole("textbox",{name:"Описание"})).not.toBeInTheDocument();
});
it("конфликт перехода сохраняет причину и требует актуальную версию",async()=>{
 mock();vi.mocked(apiFetch).mockImplementation(async(path,options)=>{if(options?.method==="POST")throw Object.assign(new Error("Изменено"),{status:409});return path==="/v1/initiatives"?{items:[item],has_more:false}:path.endsWith("/history")||path.endsWith("/comments")?{items:[],has_more:false}:item;});
 render(<InitiativesPage/>);fireEvent.click(await findButton(item.title));fireEvent.click(await findButton("Оценка"));
 fireEvent.change(screen.getByLabelText("Причина решения"),{target:{value:"Изучить стоимость"}});fireEvent.click(getButton("Подтвердить переход"));
 expect(await findButton("Загрузить актуальную карточку")).toBeInTheDocument();expect(screen.getByLabelText("Причина решения")).toHaveValue("Изучить стоимость");
 expect(getButton("Подтвердить переход")).toBeDisabled();
});
it("поздняя карточка прежней персоны игнорируется",async()=>{
 let finish!:(v:unknown)=>void;vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/initiatives"?{items:state.identity==="one"?[item]:[],has_more:false}:new Promise(resolve=>{finish=resolve;}));
 const view=render(<InitiativesPage/>);fireEvent.click(await findButton(item.title));state.identity="two";view.rerender(<InitiativesPage/>);await act(async()=>finish(item));
 expect(screen.queryByText("Поддержали: 3")).not.toBeInTheDocument();
});
it("ошибка списка повторяется явной кнопкой; потеря can_manage скрывает переходы",async()=>{
 vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Нет связи")).mockImplementation(async path=>path==="/v1/initiatives"?{items:[item],has_more:false}:path.endsWith("/history")||path.endsWith("/comments")?{items:[],has_more:false}:{...item,can_manage:false,can_moderate:false});
 render(<InitiativesPage/>);expect(await screen.findByText("Нет связи")).toBeInTheDocument();fireEvent(window, new Event("cabinet:refresh-page"));
 fireEvent.click(await findButton(item.title));await waitFor(()=>expect(screen.getByText("Поддержали: 3")).toBeInTheDocument());expect(screen.queryByRole("button",{name:"Оценка"})).not.toBeInTheDocument();
});
