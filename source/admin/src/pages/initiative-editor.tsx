import { initiativeDeadline } from "./initiative-values";
import { useEffect,useRef,useState } from "react";
import { Alert,Button,Checkbox,Form,Input,Select,Spin } from "antd";
import dayjs from "dayjs";
import { DeadlineDatePicker } from "../components/deadline-input";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { isVersionConflict } from "./version-conflict";
import { InitiativeDocumentPicker } from "./initiative-document-picker";
import { taskAssigneeOptions } from "./task-assignees";
import { initiativeNext,transitionNames,type InitiativeView } from "./initiative-types";
export function InitiativeEditor({item,action,onCancel,onSaved}:{item:InitiativeView;action:string;onCancel:()=>void;onSaved:()=>void}){
 const [form]=Form.useForm(),[current,setCurrent]=useState(item),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[blocked,setBlocked]=useState(false),[error,setError]=useState<string|null>(null);
 const [options,setOptions]=useState<{value:string;label:string}[]>([]),[ready,setReady]=useState(!["publish","planned"].includes(action));
 const required=Form.useWatch("owner_decision_required",form),generation=useRef(0),key=useRef(crypto.randomUUID()),intent=useRef("");
 const initial=useRef({building_ids:item.requested_building_ids,owner_decision_required:item.owner_decision_required,basis:item.plan_basis,responsible_person_id:item.responsible_person_id,estimated_due_at:item.estimated_due_at?dayjs(item.estimated_due_at).tz("Asia/Almaty"):undefined,decision_document_version_id:item.decision_document_version_id});
 async function loadOptions(){const g=generation.current;setBusy(true);setError(null);try{
  if(action==="planned"){const result=await apiFetch<{items:Record<string,unknown>[]}>(`/v1/initiatives/${item.id}/planning-options`);if(g===generation.current)setOptions(taskAssigneeOptions(result.items));}
  if(action==="publish"){const result=await apiFetch<{items:{id:string;code:string;name?:string}[]}>("/v1/registry/buildings");if(g===generation.current)setOptions(result.items.map(b=>({value:b.id,label:b.name??`Дом ${b.code}`})));}
  if(g===generation.current)setReady(true);
 }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Список недоступен");}finally{if(g===generation.current)setBusy(false);}}
 useEffect(()=>{if(!ready)void loadOptions();return()=>{generation.current++;};},[]);
 async function reload(){const g=generation.current;setBusy(true);try{const fresh=await apiFetch<InitiativeView>(`/v1/initiatives/${item.id}`);if(g!==generation.current)return;setCurrent(fresh);const allowed=fresh.can_manage&&(initiativeNext[fresh.stage??fresh.publication_state]??[]).includes(action);setBlocked(!allowed);setConflict(false);setError(allowed?"Сравните актуальные данные с вашим намерением. Ввод сохранён.":"Переход больше недоступен. Ввод сохранён.");}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Карточка недоступна");}finally{if(g===generation.current)setBusy(false);}}
 async function save(){if(busy||blocked||conflict||!ready)return;let values:Record<string,unknown>;try{values=await form.validateFields();}catch{return;}
  const body:Record<string,unknown>={action,reason:values.reason,expected_version:current.version};
  if(action==="publish")Object.assign(body,{building_ids:values.building_ids,owner_decision_required:!!values.owner_decision_required});
  if(action==="planned")Object.assign(body,{basis:values.basis,responsible_person_id:values.responsible_person_id,estimated_due_at:initiativeDeadline(values.estimated_due_at),owner_decision_required:current.owner_decision_required||!!values.owner_decision_required,decision_document_version_id:values.decision_document_version_id??null});
  const fingerprint=JSON.stringify(body);if(intent.current&&intent.current!==fingerprint)key.current=crypto.randomUUID();intent.current=fingerprint;
  const g=generation.current;setBusy(true);setError(null);try{await apiFetch(`/v1/initiatives/${item.id}/transitions`,{method:"POST",body,idempotencyKey:key.current});if(g===generation.current)onSaved();}catch(e){if(g===generation.current){setConflict(isVersionConflict(e));setError(e instanceof Error?e.message:"Не удалось сохранить");}}finally{if(g===generation.current)setBusy(false);}
 }
 return <ActionPanel open full title={transitionNames[action]} form={form} busy={busy} error={error} onCancel={onCancel}>
  <Alert type="info" message={`Сохранённая версия: ${current.version}. Этап: ${transitionNames[current.stage??current.publication_state]}`}/>
  {conflict&&<Button onClick={()=>void reload()}>Загрузить актуальную карточку</Button>}
  {!ready&&<><Spin aria-label="Загрузка параметров"/><Button disabled={busy} onClick={()=>void loadOptions()}>Повторить загрузку параметров</Button></>}
  <Form form={form} layout="vertical" initialValues={initial.current} disabled={busy||blocked||!ready}>
   {action==="publish"&&<Form.Item name="building_ids" label="Утверждённая аудитория" rules={[{required:true,message:"Выберите дома"}]}><Select mode="multiple" options={options}/></Form.Item>}
   {action==="planned"&&<>
    <Form.Item name="basis" label="Основание плана" rules={[{required:true,whitespace:true,message:"Укажите основание"}]}><Input.TextArea maxLength={2000}/></Form.Item>
    <Form.Item name="responsible_person_id" label="Ответственный" rules={[{required:true,message:"Выберите сотрудника"}]}><Select options={options} showSearch optionFilterProp="label"/></Form.Item>
    <Form.Item name="estimated_due_at" label="Ориентировочный срок, Алматы" rules={[{required:true,message:"Укажите срок"}]}><DeadlineDatePicker timeZone="Asia/Almaty" showTime format="DD.MM.YYYY HH:mm"/></Form.Item>
   </>}
   {["publish","planned"].includes(action)&&<Form.Item name="owner_decision_required" valuePropName="checked"><Checkbox disabled={current.owner_decision_required}>Требуется решение собственников</Checkbox></Form.Item>}
   {action==="planned"&&<Form.Item name="decision_document_version_id" label="Версия решения собственников" rules={[{required:current.owner_decision_required||!!required,message:"Выберите проверенную версию"}]}><InitiativeDocumentPicker disabled={busy||blocked||!ready}/></Form.Item>}
   <Form.Item name="reason" label="Причина решения" rules={[{required:true,whitespace:true,message:"Укажите причину"}]}><Input.TextArea maxLength={2000}/></Form.Item>
   <Button type="primary" loading={busy} disabled={blocked||conflict||!ready} onClick={()=>void save()}>Подтвердить переход</Button>
  </Form>
 </ActionPanel>;
}
