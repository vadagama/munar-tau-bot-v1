import { useEffect,useRef,useState } from "react";
import { Alert,Button,Form,Input,Select,Space,Spin,Typography } from "antd";
import { DeadlineDatePicker } from "../components/deadline-input";
import { apiFetch } from "../lib/api";
import { ActionPanel } from "./action-panel";
import { PollDetails } from "./poll-details";
import { isVersionConflict } from "./version-conflict";
import { newPollOption,pollDraftBody,pollEditorValues } from "./poll-values";
import type { PollBase,PollView } from "./poll-types";
interface Building {id:string;code:string;name?:string}
export function PollDraftEditor({poll,onCancel,onSaved}:{poll:PollView|null;onCancel:()=>void;onSaved:(id:string)=>void}){
  const [form]=Form.useForm(),[buildings,setBuildings]=useState<Building[]>([]),[ready,setReady]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [version,setVersion]=useState(poll?.version),[conflict,setConflict]=useState(false),[blocked,setBlocked]=useState(false),[fresh,setFresh]=useState<PollView|null>(null),[error,setError]=useState<string|null>(null);
  const generation=useRef(0),key=useRef(crypto.randomUUID()),intent=useRef("");
  const initial=useRef(poll?pollEditorValues(poll):{options:[newPollOption(),newPollOption()]});
  async function load(){
    const g=++generation.current;setLoading(true);setReady(false);setError(null);
    try{const result=await apiFetch<{items:Building[]}>("/v1/registry/buildings");if(g===generation.current){setBuildings(result.items);setReady(true);}}
    catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Не удалось загрузить здания");}
    finally{if(g===generation.current)setLoading(false);}
  }
  useEffect(()=>{void load();return()=>{generation.current++;};},[]);
  async function reload(){
    if(!poll)return;const g=generation.current;setBusy(true);
    try{
      const next=await apiFetch<PollView>(`/v1/polls/${poll.id}`);if(g!==generation.current)return;
      setFresh(next);setVersion(next.version);setConflict(false);setBlocked(!next.can_manage||next.state!=="draft");
      setError(!next.can_manage||next.state!=="draft"?"Черновик больше недоступен для изменения. Ваш ввод сохранён.":"Актуальная карточка загружена. Сравните сохранённые параметры с вашим вводом перед сохранением.");
    }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Карточка недоступна");}
    finally{if(g===generation.current)setBusy(false);}
  }
  async function save(){
    if(busy||!ready||conflict||blocked)return;
    let body:ReturnType<typeof pollDraftBody>;
    try{body=pollDraftBody(await form.validateFields(),poll?version:undefined);}catch(e){if(e instanceof Error)setError(e.message);return;}
    const fingerprint=JSON.stringify(body);if(intent.current&&intent.current!==fingerprint)key.current=crypto.randomUUID();intent.current=fingerprint;
    const g=generation.current;setBusy(true);setError(null);
    try{const result=await apiFetch<PollBase>(poll?`/v1/polls/${poll.id}`:"/v1/polls",{method:poll?"PATCH":"POST",idempotencyKey:key.current,body});if(g===generation.current)onSaved(result.id);}
    catch(e){if(g===generation.current){setConflict(isVersionConflict(e));setError(isVersionConflict(e)?"Черновик изменён. Загрузите актуальную карточку; ваш ввод сохранён.":e instanceof Error?e.message:"Не удалось сохранить черновик");}}
    finally{if(g===generation.current)setBusy(false);}
  }
  const missing=(poll?.building_ids??[]).filter(id=>!buildings.some(b=>b.id===id));
  return <ActionPanel open full title={poll?"Изменить черновик":"Новый опрос"} form={form} busy={busy} error={error} onCancel={onCancel}>
    <Typography.Paragraph>Информационный опрос не является решением собрания. После открытия параметры фиксируются до окончания.</Typography.Paragraph>
    {loading&&<Spin aria-label="Загрузка зданий"/>}
    {!loading&&!ready&&<Button onClick={()=>void load()}>Повторить загрузку зданий</Button>}
    {conflict&&<Button disabled={busy} onClick={()=>void reload()}>Загрузить актуальную карточку</Button>}
    {fresh&&<><Alert type="info" showIcon message={`Сохранённая версия ${fresh.version}; ваш ввод ниже`}/><PollDetails poll={fresh}/></>}
    <Form form={form} layout="vertical" initialValues={initial.current} disabled={!ready||busy||blocked}>
      <Form.Item name="question" label="Вопрос" rules={[{required:true,whitespace:true,message:"Введите вопрос"}]}><Input.TextArea maxLength={2000} autoSize={{minRows:2,maxRows:6}}/></Form.Item>
      <Form.List name="options" rules={[{validator:async(_,values:unknown[])=>{if(!values||values.length<2||values.length>20)throw new Error("Нужно от 2 до 20 вариантов");}}]}>
        {(fields,{add,remove},{errors})=><>
          {fields.map((field,index)=><div key={field.key}>
            <Form.Item name={[field.name,"key"]} hidden><Input/></Form.Item>
            <Form.Item name={[field.name,"label"]} label={`Вариант ${index+1}`} rules={[{required:true,whitespace:true,message:"Введите вариант"}]}><Input maxLength={300}/></Form.Item>
            <Button aria-label={`Удалить вариант ${index+1}`} disabled={!ready||busy||blocked||fields.length<=2} onClick={()=>remove(field.name)}>Убрать вариант</Button>
          </div>)}
          <Form.ErrorList errors={errors}/>
          <Button disabled={!ready||busy||blocked||fields.length>=20} onClick={()=>add(newPollOption())}>Добавить вариант</Button>
        </>}
      </Form.List>
      <Form.Item name="building_ids" label="Здания опроса" rules={[{required:true,message:"Выберите здания"},{validator:async(_,ids:string[])=>{if(ids?.some(id=>!buildings.some(b=>b.id===id)))throw new Error("Замените удалённое здание действующим");}}]}>
        <Select mode="multiple" options={[...buildings.map(b=>({value:b.id,label:b.name??`Здание ${b.code}`})),...missing.map(id=>({value:id,label:"Удалённое здание — замените"}))]}/>
      </Form.Item>
      <Form.Item name="closes_at" label="Окончание, Алматы" rules={[{required:true,message:"Укажите окончание"}]}><DeadlineDatePicker timeZone="Asia/Almaty" showTime format="DD.MM.YYYY HH:mm"/></Form.Item>
      <Form.Item name="reason" label="Причина сохранения" rules={[{required:true,whitespace:true,message:"Укажите причину"}]}><Input.TextArea autoSize={{minRows:2,maxRows:4}}/></Form.Item>
      <Space><Button type="primary" loading={busy} disabled={!ready||conflict||blocked} onClick={()=>void save()}>Сохранить черновик</Button></Space>
    </Form>
  </ActionPanel>;
}
