import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { InitiativePhotos } from "./initiative-photos";
import { apiFetch } from "../lib/api";
import type { InitiativeView } from "./initiative-types";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const item={id:"idea",version:4,can_attach:true} as InitiativeView;
it("загрузка передаёт версию и владельца, сохранение подтверждается сервером",async()=>{
 vi.mocked(apiFetch).mockImplementation(async path=>path.endsWith("/photos")?{items:[]}:path.endsWith("upload-url")?{attachment_id:"file"}:{});
 const changed=vi.fn();render(<InitiativePhotos item={item} onChanged={changed}/>);await screen.findByText("Фотографий нет");
 const file=new File(["jpg"],"photo.jpg",{type:"image/jpeg"});fireEvent.change(screen.getByLabelText("Фотография инициативы"),{target:{files:[file]}});fireEvent.click(screen.getByRole("button",{name:"Сохранить фотографию"}));
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(apiFetch).toHaveBeenCalledWith("/v1/files/upload-url",expect.objectContaining({body:expect.objectContaining({owner_type:"initiative",owner_id:"idea",expected_version:4})}));expect(apiFetch).toHaveBeenCalledWith("/v1/files/file/complete",{method:"POST"});
});
it("незавершённое фото можно исключить; опубликованное не предлагает изменение",async()=>{
 vi.mocked(apiFetch).mockResolvedValue({items:[{id:"file",filename:"photo.jpg",size_bytes:3,status:"incomplete"}]});const changed=vi.fn();const view=render(<InitiativePhotos item={item} onChanged={changed}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Исключить фотографию"}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(apiFetch).toHaveBeenCalledWith("/v1/initiatives/idea/photos/file/discard",expect.objectContaining({body:{expected_version:4}}));
 view.rerender(<InitiativePhotos item={{...item,can_attach:false,version:5}} onChanged={changed}/>);expect(screen.queryByLabelText("Фотография инициативы")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Исключить фотографию"})).not.toBeInTheDocument();
});

it("поздний список после загрузки не вызывает обновление закрытой карточки",async()=>{
 let finish!:(v:unknown)=>void,reads=0;
 vi.mocked(apiFetch).mockImplementation(async path=>path.endsWith("/photos")?(++reads===1?{items:[]}:new Promise(resolve=>{finish=resolve;})):path.endsWith("upload-url")?{attachment_id:"file"}:{});
 const changed=vi.fn(),view=render(<InitiativePhotos item={item} onChanged={changed}/>);await screen.findByText("Фотографий нет");
 fireEvent.change(screen.getByLabelText("Фотография инициативы"),{target:{files:[new File(["jpg"],"photo.jpg",{type:"image/jpeg"})]}});fireEvent.click(screen.getByRole("button",{name:"Сохранить фотографию"}));
 await waitFor(()=>expect(reads).toBe(2));view.unmount();await act(async()=>finish({items:[]}));expect(changed).not.toHaveBeenCalled();
});
