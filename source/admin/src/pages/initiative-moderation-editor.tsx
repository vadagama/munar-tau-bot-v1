import { initiativeDeadline } from "./initiative-values";
import { useEffect,useRef,useState } from "react";
import { Alert,Button,Form,Input } from "antd";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { DeadlineDatePicker } from "../components/deadline-input";
import { isVersionConflict } from "./version-conflict";
import type { InitiativeView } from "./initiative-types";
export function InitiativeModerationEditor({item,commentId,kind,onCancel,onSaved}:{item:InitiativeView;commentId?:string;kind:"hide_comment"|"restrict_author";onCancel:()=>void;onSaved:()=>void}){
 const [form]=Form.useForm(),[version,setVersion]=useState(item.version),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[blocked,setBlocked]=useState(false),[error,setError]=useState<string|null>(null);
 const generation=useRef(0),key=useRef(crypto.randomUUID()),intent=useRef("");useEffect(()=>()=>{generation.current++;},[]);
 async function reload(){const g=generation.current;setBusy(true);try{const row=await apiFetch<InitiativeView>(`/v1/initiatives/${item.id}`);if(g!==generation.current)return;setVersion(row.version);setBlocked(!row.can_moderate);setConflict(false);setError(row.can_moderate?"Карточка перечитана. Ввод сохранён; проверьте решение.":"Полномочия изменились. Ввод сохранён, действие недоступно.");}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Карточка недоступна");}finally{if(g===generation.current)setBusy(false);}}
 async function save(){if(busy||blocked||conflict)return;let values:Record<string,unknown>;try{values=await form.validateFields();}catch{return;}
 const body={initiative_id:item.id,kind,reason:values.reason,expected_version:version,...(commentId?{comment_id:commentId}:{}),...(kind==="restrict_author"?{until_at:initiativeDeadline(values.until_at)}: {})};
 const fingerprint=JSON.stringify(body);if(intent.current&&intent.current!==fingerprint)key.current=crypto.randomUUID();intent.current=fingerprint;const g=generation.current;setBusy(true);setError(null);
 try{await apiFetch("/v1/moderation/actions",{method:"POST",body,idempotencyKey:key.current});if(g===generation.current)onSaved();}catch(e){if(g===generation.current){setConflict(isVersionConflict(e));setError(e instanceof Error?e.message:"Не удалось сохранить");}}finally{if(g===generation.current)setBusy(false);}}
 return <ActionPanel open full title={kind==="hide_comment"?"Скрыть комментарий":"Ограничить автора"} form={form} busy={busy} error={error} onCancel={onCancel}>
 <Alert type="warning" message={kind==="hide_comment"?"Оригинал сохраняется. Автор получит причину и сможет оспорить решение.":"Ограничение затрагивает только новые инициативы и комментарии. Укажите конечный срок."}/>
 {conflict&&<Button onClick={()=>void reload()}>Загрузить актуальную карточку</Button>}
 <Form form={form} layout="vertical" disabled={busy||blocked}>
  <Form.Item name="reason" label="Причина модерации" rules={[{required:true,whitespace:true,message:"Укажите причину"}]}><Input.TextArea maxLength={2000}/></Form.Item>
  {kind==="restrict_author"&&<Form.Item name="until_at" label="Ограничить до, Алматы" rules={[{required:true,message:"Укажите конечный срок"}]}><DeadlineDatePicker timeZone="Asia/Almaty" showTime format="DD.MM.YYYY HH:mm"/></Form.Item>}
  <Button type="primary" danger disabled={conflict||blocked} loading={busy} onClick={()=>void save()}>Сохранить решение модерации</Button>
 </Form></ActionPanel>;
}
