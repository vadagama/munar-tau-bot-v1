import { useEffect,useRef,useState } from "react";
import { Alert,Button,Form,Input,Space } from "antd";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { isVersionConflict } from "./version-conflict";
import { PollDetails } from "./poll-details";
import type { PollBase,PollView } from "./poll-types";
export function PollTransitionEditor({poll,action,onCancel,onSaved}:{poll:PollView;action:"open"|"cancel";onCancel:()=>void;onSaved:(id:string)=>void}){
  const [form]=Form.useForm(),[version,setVersion]=useState(poll.version),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[blocked,setBlocked]=useState(false);
  const [error,setError]=useState<string|null>(null),[fresh,setFresh]=useState<PollView|null>(null);
  const generation=useRef(0),key=useRef(crypto.randomUUID()),intent=useRef("");
  useEffect(()=>()=>{generation.current++;},[]);
  async function reload(){
    const g=generation.current;setBusy(true);
    try{
      const next=await apiFetch<PollView>(`/v1/polls/${poll.id}`);
      if(g!==generation.current)return;
      setFresh(next);
      const unavailable=!next.can_manage||next.deadline_passed||(action==="open"?next.state!=="draft":next.state!=="open");
      setBlocked(unavailable);setConflict(false);setVersion(next.version);
      setError(unavailable?"Действие больше недоступно. Ваш ввод сохранён; закройте форму и проверьте карточку.":"Актуальная карточка загружена. Сравните её с вашим намерением перед повторным подтверждением.");
    }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Карточка недоступна");}
    finally{if(g===generation.current)setBusy(false);}
  }
  async function save(){
    if(busy||conflict||blocked)return;
    let values:{reason:string};try{values=await form.validateFields();}catch{return;}
    const body={action,expected_version:version,reason:values.reason},fingerprint=JSON.stringify(body);
    if(intent.current&&intent.current!==fingerprint)key.current=crypto.randomUUID();intent.current=fingerprint;
    const g=generation.current;setBusy(true);setError(null);
    try{const result=await apiFetch<PollBase>(`/v1/polls/${poll.id}/transitions`,{method:"POST",idempotencyKey:key.current,body});if(g===generation.current)onSaved(result.id);}
    catch(e){if(g===generation.current){setConflict(isVersionConflict(e));setError(isVersionConflict(e)?"Карточка изменилась. Загрузите актуальную версию; причина сохранена.":e instanceof Error?e.message:"Не удалось выполнить действие");}}
    finally{if(g===generation.current)setBusy(false);}
  }
  const opening=action==="open";
  return <ActionPanel open full title={opening?"Открыть опрос":"Отменить опрос"} form={form} busy={busy} error={error} onCancel={onCancel}>
    <Alert type="warning" showIcon message={opening?"После открытия вопрос, варианты, аудиторию и срок изменить нельзя":"Отмена окончательна; результаты не будут доступны"}/>
    <PollDetails poll={fresh??poll}/>
    {conflict&&<Button disabled={busy} onClick={()=>void reload()}>Загрузить актуальную карточку</Button>}
    <Form form={form} layout="vertical" disabled={busy||blocked}>
      <Form.Item name="reason" label={opening?"Причина открытия":"Причина отмены"} rules={[{required:true,whitespace:true,message:"Укажите причину"}]}><Input.TextArea autoSize={{minRows:2,maxRows:6}}/></Form.Item>
      <Space><Button type="primary" danger={!opening} loading={busy} disabled={conflict||blocked} onClick={()=>void save()}>{opening?"Подтвердить открытие":"Подтвердить отмену"}</Button></Space>
    </Form>
  </ActionPanel>;
}
