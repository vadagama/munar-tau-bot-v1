import { FilterOutlined } from "@ant-design/icons";
import { InitiativePhotos } from "./initiative-photos";
import { useEffect,useRef,useState } from "react";
import { Alert,Button,Descriptions,Empty,Select,Space,Spin,Tabs,Tag,Typography } from "antd";
import { PageLayout } from "../components/page-layout";
import { ConfigurableTable } from "../components/configurable-table";
import { DetailSection } from "../components/detail-section";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { usePageRefresh } from "../lib/use-page-refresh";
import { CardDrawer } from "./card-drawer";
import { InitiativeEditor } from "./initiative-editor";
import { InitiativeDiscussion } from "./initiative-discussion";
import { InitiativeHistory } from "./initiative-history";
import { InitiativeModerationEditor } from "./initiative-moderation-editor";
import { InitiativeModerationQueue } from "./initiative-moderation-queue";
import { initiativeDate as pollDate } from "./initiative-types";
import { initiativeStates,initiativeNext,transitionNames,type InitiativeView } from "./initiative-types";
const failure=(e:unknown)=>e instanceof Error?e.message:"Не удалось загрузить инициативы";
export function InitiativesPage(){
 const {identity,roles}=useCabinetIdentity(),identityKey=`${identity?.me?.person?.id??identity?.id??""}:${identity?.me?.emulation?.session_id??""}:${[...roles].sort().join(",")}:${JSON.stringify(identity?.me?.assignments??[])}`;
 const [tab,setTab]=useState("initiatives"),[rows,setRows]=useState<InitiativeView[]>([]),[more,setMore]=useState(false),[offset,setOffset]=useState(0),[state,setState]=useState<string|undefined>();
 const [loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[card,setCard]=useState<InitiativeView|null>(null),[selected,setSelected]=useState<string|null>(null),[drawer,setDrawer]=useState(false),[cardLoading,setCardLoading]=useState(false),[cardError,setCardError]=useState<string|null>(null);
 const [action,setAction]=useState<string|null>(null),[moderation,setModeration]=useState<{kind:"hide_comment"|"restrict_author";commentId?:string}|null>(null),[supportBusy,setSupportBusy]=useState(false);
 const listGeneration=useRef(0),cardGeneration=useRef(0),supportGeneration=useRef(0),supportKey=useRef(crypto.randomUUID()),supportIntent=useRef("");
 async function load(){const g=++listGeneration.current;setLoading(true);setError(null);try{const result=await apiFetch<{items:InitiativeView[];has_more:boolean}>("/v1/initiatives",{query:{offset:String(offset),limit:"20",state}});if(g===listGeneration.current){setRows(result.items);setMore(result.has_more);}}catch(e){if(g===listGeneration.current)setError(failure(e));}finally{if(g===listGeneration.current)setLoading(false);}}
 function close(){cardGeneration.current++;supportGeneration.current++;setDrawer(false);setCard(null);setSelected(null);setAction(null);setModeration(null);setCardLoading(false);setCardError(null);setSupportBusy(false);}
 async function open(id:string,quiet=false){const g=++cardGeneration.current;setSelected(id);setDrawer(true);if(!quiet){supportGeneration.current++;setSupportBusy(false);setAction(null);setModeration(null);setCard(null);}setCardError(null);setCardLoading(true);
 try{const next=await apiFetch<InitiativeView>(`/v1/initiatives/${id}`);if(g===cardGeneration.current)setCard(next);}catch(e){if(g===cardGeneration.current)setCardError(failure(e));}finally{if(g===cardGeneration.current)setCardLoading(false);}}
 useEffect(()=>{listGeneration.current++;close();setRows([]);setOffset(0);setTab("initiatives");return()=>{listGeneration.current++;cardGeneration.current++;};},[identityKey]);
 useEffect(()=>{void load();return()=>{listGeneration.current++;};},[identityKey,offset,state]);
 usePageRefresh(async()=>{const g=cardGeneration.current;await load();if(g===cardGeneration.current&&selected&&!action&&!moderation)await open(selected,true);},()=>!action&&!moderation&&!cardLoading&&!supportBusy);
 function saved(){setAction(null);setModeration(null);if(selected)void open(selected,true);void load();}
 async function support(){if(!card||supportBusy)return;const id=card.id,withdraw=card.own_support.supported,fingerprint=`${id}:${card.own_support.version}:${withdraw}`;if(supportIntent.current!==fingerprint)supportKey.current=crypto.randomUUID();supportIntent.current=fingerprint;const token=++supportGeneration.current,g=cardGeneration.current;setSupportBusy(true);setCardError(null);
 try{await apiFetch(`/v1/initiatives/${id}/support`,{method:withdraw?"DELETE":"POST",idempotencyKey:supportKey.current,...(withdraw?{query:{expected_version:String(card.own_support.version)}}:{body:{expected_version:card.own_support.version}})});if(g===cardGeneration.current)await open(id,true);}catch(e){if(g===cardGeneration.current)setCardError(failure(e));}finally{if(token===supportGeneration.current)setSupportBusy(false);}}
 const scope=(ids:string[])=>ids.map(id=>card?.buildings?.find(b=>b.id===id)?.label??"Дом недоступен").join(", ");
 return <PageLayout title="Инициативы" filters={tab === "initiatives" && <Select prefix={<FilterOutlined aria-hidden />} aria-label="Состояние инициативы" allowClear placeholder="Все состояния" value={state} options={Object.entries(initiativeStates).map(([value,label])=>({value,label}))} onChange={value=>{setOffset(0);setState(value);}}/>}>
 <Tabs activeKey={tab} onChange={value=>{close();setTab(value);}} items={[{key:"initiatives",label:"Инициативы"},{key:"actions",label:"Модерация"},{key:"appeals",label:"Оспаривания"}]}/>
 {tab!=="initiatives"?<InitiativeModerationQueue key={`${identityKey}:${tab}`} mode={tab as "actions"|"appeals"}/>:<>


 {error&&<Alert role="alert" type="error" message={error}/>}
 {!loading&&!error&&!rows.length?<Empty description="Инициатив пока нет"/>:<ConfigurableTable storageKey="initiatives" onMobileRowClick={row => void open(row.id)} rowKey="id" loading={loading} dataSource={rows} pagination={false} scroll={{x:600}} columns={[
  {key:"title",title:"Инициатива",render:(_v:unknown,row:InitiativeView)=><Button type="link" onClick={()=>void open(row.id)}>{row.title}</Button>},
  {key:"state",title:"Этап",render:(_v:unknown,row:InitiativeView)=><Tag>{initiativeStates[row.stage??row.publication_state]}</Tag>},
  {key:"location",title:"Место",dataIndex:"location_text"},
 ]}/>}
 <Space><Button disabled={loading||!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Назад</Button><Typography.Text>Страница {offset/20+1}</Typography.Text><Button disabled={loading||!more} onClick={()=>setOffset(offset+20)}>Дальше</Button></Space>
 </>}
 <CardDrawer open={drawer} title="Инициатива" onClose={close}>
  {cardLoading&&!card&&<Spin aria-label="Загрузка инициативы"/>}{cardError&&<Alert role="alert" type="error" message={cardError} action={selected?<Button onClick={()=>void open(selected,true)}>Повторить загрузку</Button>:undefined}/>}
  {card&&<>
   <DetailSection title="Карточка инициативы"><Typography.Title level={4}>{card.title}</Typography.Title><Typography.Paragraph>{card.body}</Typography.Paragraph>
    <Descriptions column={1} size="small" items={[{key:"stage",label:"Этап",children:initiativeStates[card.stage??card.publication_state]},{key:"location",label:"Место",children:card.location_text},{key:"scope",label:"Утверждённая аудитория",children:scope(card.approved_building_ids) || "Не утверждена"},{key:"requested",label:"Запрошенная аудитория",children:scope(card.requested_building_ids)},{key:"reason",label:"Основание этапа",children:card.stage_reason??card.review_reason??"—"}]}/>
    <Typography.Paragraph>Поддержали: {card.support_count}</Typography.Paragraph>
    {card.can_support&&<Button disabled={supportBusy} onClick={()=>void support()}>{card.own_support.supported?"Отозвать поддержку":"Поддержать инициативу"}</Button>}
    {card.plan_basis&&<Typography.Paragraph>План: {card.plan_basis}. Ответственный: {card.responsible_name??"Не указан"}. Срок: {pollDate(card.estimated_due_at)}.</Typography.Paragraph>}
   </DetailSection>
   <Space wrap>{card.can_manage&&(initiativeNext[card.stage??card.publication_state]??[]).map(next=><Button key={next} onClick={()=>{cardGeneration.current++;setAction(next);}}>{transitionNames[next]}</Button>)}{card.can_moderate&&<Button danger onClick={()=>{cardGeneration.current++;setModeration({kind:"restrict_author"});}}>Ограничить автора инициативы</Button>}</Space>
   <InitiativePhotos key={`photos:${identityKey}:${card.id}`} item={card} onChanged={()=>void open(card.id,true)}/>
   <InitiativeHistory key={`history:${card.id}`} id={card.id} version={card.version}/>
   <InitiativeDiscussion key={`discussion:${card.id}`} item={card} onChanged={()=>void open(card.id,true)} onModerate={(commentId,kind)=>{cardGeneration.current++;setModeration({commentId,kind});}}/>
   {action&&<InitiativeEditor key={`${identityKey}:${card.id}:${action}`} item={card} action={action} onCancel={()=>setAction(null)} onSaved={saved}/>}
   {moderation&&<InitiativeModerationEditor key={`${identityKey}:${card.id}:${moderation.kind}:${moderation.commentId??"author"}`} item={card} kind={moderation.kind} commentId={moderation.commentId} onCancel={()=>setModeration(null)} onSaved={saved}/>}
  </>}
 </CardDrawer>
 </PageLayout>;
}
