import { getButton,findButton } from "../test/buttons";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { apiFetch } from "../lib/api";
import { InitiativeEditor } from "./initiative-editor";
import { InitiativeModerationQueue } from "./initiative-moderation-queue";
import type { InitiativeView } from "./initiative-types";
vi.mock("../lib/api",()=>({apiFetch:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
it("план требует основание, сотрудника, срок и проверенное решение; пустая форма не отправляется",async()=>{
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/documents"?{items:[],total:0}:{items:[]});
 const item={id:"item",version:3,stage:"assessing",publication_state:"published",can_manage:true,requested_building_ids:["house"],owner_decision_required:true} as InitiativeView;
 render(<InitiativeEditor item={item} action="planned" onCancel={()=>{}} onSaved={()=>{}}/>);
 const save=await screen.findByText("Подтвердить переход",{}, {timeout:5000});await waitFor(()=>expect(save.closest("button")).toBeEnabled());fireEvent.click(save);
 await waitFor(()=>{expect(screen.getByText("Укажите основание")).toBeVisible();expect(screen.getByText("Выберите сотрудника")).toBeVisible();expect(screen.getByText("Укажите срок")).toBeVisible();expect(screen.getAllByText("Выберите проверенную версию")).toHaveLength(2);},{timeout:3000});
 expect(screen.getByLabelText("Требуется решение собственников")).toBeDisabled();expect(vi.mocked(apiFetch).mock.calls.every(([,options])=>!options?.method)).toBe(true);
});
it("решение оспаривания передаёт версии жалобы и исходного действия",async()=>{
 const action={id:"action",kind:"restrict_author",reason:"Причина",version:4,until_at:"2026-10-25T10:00:00Z",original_until_at:"2026-10-25T10:00:00Z",revoked_at:null};
 const appeal={id:"appeal",action_id:"action",reason:"Прошу проверить",status:"open",version:2,action,can_resolve:true,decisions:[]};
 vi.mocked(apiFetch).mockImplementation(async(path,options)=>options?.method?{...appeal,status:"resolved",can_resolve:false}:path==="/v1/moderation/appeals"?{items:[appeal],has_more:false}:appeal);
 render(<InitiativeModerationQueue mode="appeals"/>);fireEvent.click(await findButton("Прошу проверить"));fireEvent.click(await findButton("Рассмотреть оспаривание"));
 fireEvent.change(screen.getByLabelText("Основание решения председателя"),{target:{value:"Проверено"}});fireEvent.click(getButton("Подтвердить решение"));
 await waitFor(()=>expect(vi.mocked(apiFetch).mock.calls.some(([path,options])=>path==="/v1/moderation/appeals/appeal/resolve"&&JSON.stringify(options?.body)==='{"reason":"Проверено","expected_version":2,"action_expected_version":4,"resolution":"uphold"}')).toBe(true));
});
it("автор читает скрытый оригинал из решения модерации без повторного открытия инициативы",async()=>{
 const action={id:"action",kind:"hide_comment",comment_id:"comment",reason:"Причина скрытия",version:1,until_at:null,original_until_at:null,revoked_at:null,decisions:[],can_appeal:true};
 vi.mocked(apiFetch).mockImplementation(async path=>path==="/v1/moderation/actions"?{items:[action],has_more:false}:path==="/v1/initiative-comments/comment"?{id:"comment",author_name:"Житель",body:"Сохранённый оригинал",hidden:true}:action);
 render(<InitiativeModerationQueue mode="actions"/>);fireEvent.click(await findButton("Причина скрытия"));
 expect(await screen.findByText("Сохранённый оригинал")).toBeInTheDocument();expect(getButton("Оспорить решение")).toBeInTheDocument();
 expect(vi.mocked(apiFetch).mock.calls.some(([path])=>path.startsWith("/v1/initiatives/"))).toBe(false);
});
