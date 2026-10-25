import { useEffect,useRef,useState } from "react";
import { Alert,Button,Empty,Input,List,Space,Tag,Typography } from "antd";
import { DetailSection } from "../components/detail-section";
import { apiFetch } from "../lib/api";
import { isVersionConflict } from "./version-conflict";
import { pollDate } from "./poll-types";
import type { InitiativeView,InitiativeComment } from "./initiative-types";
export function InitiativeDiscussion({item,onChanged,onModerate}:{item:InitiativeView;onChanged:()=>void;onModerate:(commentId:string,kind:"hide_comment"|"restrict_author")=>void}){
 const [comments,setComments]=useState<InitiativeComment[]>([]),[more,setMore]=useState(false),[offset,setOffset]=useState(0),[text,setText]=useState("");
 const [busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState<string|null>(null),generation=useRef(0),key=useRef(crypto.randomUUID()),intent=useRef("");
 async function load(){const g=++generation.current;setBusy(true);setError(null);try{const result=await apiFetch<{items:InitiativeComment[];has_more:boolean}>(`/v1/initiatives/${item.id}/comments`,{query:{offset:String(offset)}});if(g===generation.current){setComments(result.items);setMore(result.has_more);}}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Обсуждение недоступно");}finally{if(g===generation.current)setBusy(false);}}
 useEffect(()=>{setConflict(false);void load();return()=>{generation.current++;};},[item.id,item.version,offset]);
 async function send(){if(busy||conflict||!text.trim())return;const body={body:text,expected_version:item.version},fingerprint=JSON.stringify(body);if(intent.current&&intent.current!==fingerprint)key.current=crypto.randomUUID();intent.current=fingerprint;
 const g=generation.current;setBusy(true);setError(null);try{await apiFetch(`/v1/initiatives/${item.id}/comments`,{method:"POST",body,idempotencyKey:key.current});if(g===generation.current){setText("");key.current=crypto.randomUUID();void load();onChanged();}}catch(e){if(g===generation.current){setConflict(isVersionConflict(e));setError(e instanceof Error?e.message:"Комментарий не сохранён");}}finally{if(g===generation.current)setBusy(false);}}
 return <DetailSection title="Обсуждение">
 {error&&<Alert role="alert" type="error" message={error} action={<Button onClick={()=>void load()}>Повторить загрузку</Button>}/>}
 {!busy&&!comments.length&&<Empty description="Комментариев пока нет"/>}
 <List loading={busy} dataSource={comments} renderItem={comment=><List.Item><Space direction="vertical">
  <Typography.Text strong>{comment.author_name}</Typography.Text><Typography.Text type="secondary">{pollDate(comment.created_at)}</Typography.Text>
  {comment.hidden&&<Tag>Скрыт для аудитории</Tag>}<Typography.Paragraph>{comment.body}</Typography.Paragraph>
  {item.can_moderate&&<Space wrap>{!comment.hidden&&<Button onClick={()=>onModerate(comment.id,"hide_comment")}>Скрыть комментарий</Button>}<Button onClick={()=>onModerate(comment.id,"restrict_author")}>Ограничить автора комментария</Button></Space>}
 </Space></List.Item>}/>
 <Space><Button disabled={busy||!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Предыдущие комментарии</Button><Button disabled={busy||!more} onClick={()=>setOffset(offset+20)}>Следующие комментарии</Button></Space>
 {conflict&&<Button onClick={onChanged}>Загрузить актуальную версию инициативы</Button>}
 {item.can_comment&&<><Input.TextArea aria-label="Ваш комментарий" value={text} maxLength={10000} onChange={e=>setText(e.target.value)}/><Button disabled={busy||conflict||!text.trim()} onClick={()=>void send()}>Отправить комментарий</Button></>}
 </DetailSection>;
}
