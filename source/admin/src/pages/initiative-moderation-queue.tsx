import { usePageRefresh } from "../lib/use-page-refresh";
import { initiativeDeadline } from "./initiative-values";
import { useEffect,useRef,useState } from "react";
import { Alert,Button,Empty,Form,Input,List,Select,Space,Spin,Typography } from "antd";
import { apiFetch } from "../lib/api";
import { ConfigurableTable } from "../components/configurable-table";
import { DeadlineDatePicker } from "../components/deadline-input";
import { DetailSection } from "../components/detail-section";
import { CardDrawer } from "./card-drawer";
import { ActionPanel } from "./action-panel";
import { isVersionConflict } from "./version-conflict";
import { initiativeDate as pollDate } from "./initiative-types";
import type { ModerationView,AppealView,InitiativeComment } from "./initiative-types";
const resolutions:Record<string,string>={uphold:"Оставить в силе",shorten:"Сократить срок",revoke:"Снять решение"};
export function InitiativeModerationQueue({mode}:{mode:"actions"|"appeals"}){
 const base=`/v1/moderation/${mode}`,[rows,setRows]=useState<(ModerationView|AppealView)[]>([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const [card,setCard]=useState<ModerationView|AppealView|null>(null),[drawer,setDrawer]=useState(false),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[blocked,setBlocked]=useState(false);
 const [form]=Form.useForm(),resolution=Form.useWatch("resolution",form),listGeneration=useRef(0),cardGeneration=useRef(0),key=useRef(crypto.randomUUID()),intent=useRef("");
 async function load(){const g=++listGeneration.current;setLoading(true);setError(null);try{const result=await apiFetch<{items:(ModerationView|AppealView)[];has_more:boolean}>(base,{query:{offset:String(offset)}});if(g===listGeneration.current){setRows(result.items);setMore(result.has_more);}}catch(e){if(g===listGeneration.current)setError(e instanceof Error?e.message:"Очередь недоступна");}finally{if(g===listGeneration.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{listGeneration.current++;cardGeneration.current++;};},[offset,mode]);
 function close(){cardGeneration.current++;setDrawer(false);setCard(null);setEditing(false);setBusy(false);setConflict(false);setBlocked(false);setError(null);form.resetFields();}
 async function open(id:string,reload=false){const g=++cardGeneration.current;setDrawer(true);setBusy(true);setError(null);if(!reload){setCard(null);setEditing(false);setConflict(false);setBlocked(false);form.resetFields();}
 try{const next=await apiFetch<ModerationView|AppealView>(`${base}/${id}`);if(g!==cardGeneration.current)return;setCard(next);if(reload){setConflict(false);setBlocked(mode==="appeals"?!(next as AppealView).can_resolve:!(next as ModerationView).can_appeal);setError("Актуальное решение загружено. Ввод сохранён; проверьте намерение.");}}catch(e){if(g===cardGeneration.current)setError(e instanceof Error?e.message:"Карточка недоступна");}finally{if(g===cardGeneration.current)setBusy(false);}}
 async function save(){if(!card||busy||blocked||conflict)return;let values:Record<string,unknown>;try{values=await form.validateFields();}catch{return;}
 const appeal=mode==="appeals"?card as AppealView:null,body={reason:values.reason,expected_version:card.version,...(appeal?{action_expected_version:appeal.action.version,resolution:values.resolution,...(values.resolution==="shorten"?{until_at:initiativeDeadline(values.until_at)}: {})}: {})};
 const fingerprint=JSON.stringify(body);if(intent.current&&intent.current!==fingerprint)key.current=crypto.randomUUID();intent.current=fingerprint;const g=cardGeneration.current;setBusy(true);setError(null);
 try{await apiFetch(appeal?`/v1/moderation/appeals/${card.id}/resolve`:`/v1/moderation/${card.id}/appeal`,{method:"POST",body,idempotencyKey:key.current});if(g===cardGeneration.current){setEditing(false);form.resetFields();key.current=crypto.randomUUID();void open(card.id);void load();}}catch(e){if(g===cardGeneration.current){setConflict(isVersionConflict(e));setError(e instanceof Error?e.message:"Не удалось сохранить");}}finally{if(g===cardGeneration.current)setBusy(false);}}
 const appeal=mode==="appeals"?card as AppealView|null:null,action=appeal?.action??card as ModerationView|null;
 usePageRefresh(load, () => !loading && !drawer);
 return <>

 {error&&!drawer&&<Alert role="alert" type="error" message={error}/>}
 {!loading&&!rows.length?<Empty description={mode==="appeals"?"Оспариваний пока нет":"Решений модерации пока нет"}/>:<ConfigurableTable storageKey={`initiatives-${mode}`} onMobileRowClick={row => void open(row.id)} rowKey="id" dataSource={rows} loading={loading} pagination={false} columns={[
  {key:"reason",title:mode==="appeals"?"Обоснование оспаривания":"Причина модерации",render:(_v:unknown,row:ModerationView|AppealView)=><Button type="link" onClick={()=>void open(row.id)}>{row.reason}</Button>},
  {key:"state",title:"Состояние",render:(_v:unknown,row:ModerationView|AppealView)=>"status" in row?(row.status==="open"?"Открыто":"Рассмотрено"):row.revoked_at?"Снято":row.kind==="hide_comment"?"Комментарий скрыт":`Ограничение до ${pollDate(row.until_at)}`},
 ]}/>}
 <Space><Button disabled={loading||!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Назад</Button><Button disabled={loading||!more} onClick={()=>setOffset(offset+20)}>Дальше</Button></Space>
 <CardDrawer open={drawer} title={mode==="appeals"?"Оспаривание модерации":"Решение модерации"} onClose={close}>
  {busy&&!card&&<Spin aria-label="Загрузка решения"/>}{error&&!editing&&<Alert role="alert" type="error" message={error}/>}
  {card&&action&&<>
   <DetailSection title="Исходное действие"><Typography.Paragraph>{action.kind==="hide_comment"?"Скрытие комментария":"Временное ограничение автора"}</Typography.Paragraph><Typography.Paragraph>{action.reason}</Typography.Paragraph><Typography.Paragraph>Исходный срок: {pollDate(action.original_until_at)}. Действующий срок: {pollDate(action.until_at)}.</Typography.Paragraph>{action.revoked_at&&<Alert type="success" message="Решение снято"/>}</DetailSection>
   {action.comment_id&&<OriginalComment key={action.comment_id} id={action.comment_id}/>}
   {appeal&&<DetailSection title="Аргументы автора"><Typography.Paragraph>{appeal.reason}</Typography.Paragraph></DetailSection>}
   <List header="История рассмотрения" dataSource={card.decisions??[]} renderItem={d=><List.Item>{resolutions[d.resolution]}: {d.reason} {d.until_at&&`До ${pollDate(d.until_at)}`}</List.Item>}/>
   {!editing&&((appeal?.can_resolve)||(!appeal&&(card as ModerationView).can_appeal))&&<Button type="primary" onClick={()=>{setEditing(true);key.current=crypto.randomUUID();intent.current="";}}>{appeal?"Рассмотреть оспаривание":"Оспорить решение"}</Button>}
   {editing&&<ActionPanel open full title={appeal?"Решение председателя":"Оспаривание решения"} busy={busy} error={error} form={form} onCancel={()=>setEditing(false)}>
    <Typography.Paragraph>Исходное действие: {action.reason}. Действующий срок: {pollDate(action.until_at)}.</Typography.Paragraph>
    {appeal&&<Typography.Paragraph>Обоснование автора: {appeal.reason}</Typography.Paragraph>}
    {conflict&&<Button onClick={()=>void open(card.id,true)}>Загрузить актуальное решение</Button>}
    <Form form={form} layout="vertical" initialValues={{resolution:"uphold"}} disabled={busy||blocked}>
     {appeal&&<Form.Item name="resolution" label="Результат рассмотрения" rules={[{required:true}]}><Select options={Object.entries(resolutions).filter(([value])=>value!=="shorten"||action.kind==="restrict_author").map(([value,label])=>({value,label}))}/></Form.Item>}
     {appeal&&resolution==="shorten"&&<Form.Item name="until_at" label="Новый срок, Алматы" rules={[{required:true,message:"Укажите сокращённый срок"}]}><DeadlineDatePicker timeZone="Asia/Almaty" showTime format="DD.MM.YYYY HH:mm"/></Form.Item>}
     <Form.Item name="reason" label={appeal?"Основание решения председателя":"Обоснование оспаривания"} rules={[{required:true,whitespace:true,message:"Укажите основание"}]}><Input.TextArea maxLength={2000}/></Form.Item>
     <Button type="primary" disabled={blocked||conflict} loading={busy} onClick={()=>void save()}>Подтвердить решение</Button>
    </Form>
   </ActionPanel>}
  </>}
 </CardDrawer>
 </>;
}

function OriginalComment({id}:{id:string}) {
 const [comment,setComment]=useState<InitiativeComment|null>(null),[error,setError]=useState<string|null>(null),generation=useRef(0);
 async function load(){const g=++generation.current;setError(null);try{const row=await apiFetch<InitiativeComment>(`/v1/initiative-comments/${id}`);if(g===generation.current)setComment(row);}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Оригинал недоступен");}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[id]);
 return <DetailSection title="Оригинал комментария">{error?<Alert role="alert" type="error" message={error} action={<Button onClick={()=>void load()}>Повторить загрузку оригинала</Button>}/>:comment?<><Typography.Text strong>{comment.author_name}</Typography.Text><Typography.Paragraph>{comment.body}</Typography.Paragraph></>:<Spin aria-label="Загрузка оригинала комментария"/>}</DetailSection>;
}
