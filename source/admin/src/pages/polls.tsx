import { FilterOutlined } from "@ant-design/icons";
import { useEffect,useRef,useState } from "react";
import { Alert,Button,Empty,Select,Space,Spin,Tag,Typography } from "antd";
import { PageLayout } from "../components/page-layout";
import { ConfigurableTable } from "../components/configurable-table";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { usePageRefresh } from "../lib/use-page-refresh";
import { CardDrawer } from "./card-drawer";
import { PollDetails } from "./poll-details";
import { PollResults } from "./poll-results";
import { PollDraftEditor } from "./poll-draft-editor";
import { PollTransitionEditor } from "./poll-transition-editor";
import { pollDate,pollStates,type PollView } from "./poll-types";
const failure=(e:unknown)=>e instanceof Error?e.message:"Не удалось загрузить опросы";
export function PollsPage(){
  const {identity,roles}=useCabinetIdentity(),manager=roles.some(role=>["chairman","administrator","deputy"].includes(role));
  const identityKey=`${identity?.me?.person?.id??identity?.id??""}:${identity?.me?.emulation?.session_id??""}:${[...roles].sort().join(",")}:${JSON.stringify(identity?.me?.assignments??[])}`;
  const [rows,setRows]=useState<PollView[]>([]),[more,setMore]=useState(false),[offset,setOffset]=useState(0),[state,setState]=useState<string|undefined>();
  const [loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[card,setCard]=useState<PollView|null>(null),[selectedId,setSelectedId]=useState<string|null>(null);
  const [drawer,setDrawer]=useState(false),[cardLoading,setCardLoading]=useState(false),[cardError,setCardError]=useState<string|null>(null),[action,setAction]=useState<"create"|"edit"|"open"|"cancel"|null>(null);
  const listGeneration=useRef(0),cardGeneration=useRef(0);
  async function load(){
    const g=++listGeneration.current;setLoading(true);setError(null);
    try{const result=await apiFetch<{items:PollView[];has_more:boolean}>("/v1/polls",{query:{offset:String(offset),limit:"20",state}});if(g===listGeneration.current){setRows(result.items);setMore(result.has_more);}}
    catch(e){if(g===listGeneration.current)setError(failure(e));}
    finally{if(g===listGeneration.current)setLoading(false);}
  }
  function close(){cardGeneration.current++;setDrawer(false);setCard(null);setSelectedId(null);setAction(null);setCardLoading(false);setCardError(null);}
  async function open(id:string){
    const g=++cardGeneration.current;setSelectedId(id);setDrawer(true);setAction(null);setCard(null);setCardError(null);setCardLoading(true);
    try{const next=await apiFetch<PollView>(`/v1/polls/${id}`);if(g===cardGeneration.current)setCard(next);}
    catch(e){if(g===cardGeneration.current)setCardError(failure(e));}
    finally{if(g===cardGeneration.current)setCardLoading(false);}
  }
  function create(){cardGeneration.current++;setSelectedId(null);setCard(null);setCardLoading(false);setCardError(null);setAction("create");setDrawer(true);}
  useEffect(()=>{listGeneration.current++;close();setRows([]);setOffset(0);return()=>{listGeneration.current++;cardGeneration.current++;};},[identityKey]);
  useEffect(()=>{void load();return()=>{listGeneration.current++;};},[identityKey,offset,state]);
  usePageRefresh(async()=>{const g=cardGeneration.current;await load();if(g===cardGeneration.current&&selectedId&&!action)await open(selectedId);},()=>!action&&!cardLoading);
  function beginAction(next:"edit"|"open"|"cancel"){cardGeneration.current++;setAction(next);}
  function saved(id:string){void open(id);void load();}
  return <PageLayout title="Опросы" actions={<Space wrap>
    {manager&&<Button type="primary" onClick={create}>Новый опрос</Button>}

  </Space>} filters={<Select prefix={<FilterOutlined aria-hidden />} aria-label="Состояние опроса" allowClear placeholder="Все состояния" value={state}
    options={Object.entries(pollStates).map(([value,label])=>({value,label}))} onChange={value=>{setOffset(0);setState(value);}}/>}>
    <Alert className="cabinet-page__intro" type="info" showIcon message="Информационные опросы не являются решениями собрания"/>
    {error&&<Alert role="alert" type="error" showIcon message={error}/>}
    {!loading&&!error&&!rows.length?<Empty description="Опросов пока нет"/>:<ConfigurableTable storageKey="polls" onMobileRowClick={row => void open(row.id)} rowKey="id" loading={loading} dataSource={rows} mobileRender={row => <div className="mobile-summary"><Button type="link" onClick={() => void open(row.id)}>{row.question}</Button><div><Tag>{pollStates[row.state]}</Tag></div><Typography.Text type="secondary">Окончание, Алматы: {pollDate(row.closes_at)}</Typography.Text></div>} pagination={false} scroll={{x:640}} columns={[
      {key:"question",title:"Вопрос",dataIndex:"question",render:(_value:string,row:PollView)=><Button type="link" onClick={()=>void open(row.id)}>{row.question}</Button>},
      {key:"state",title:"Состояние",dataIndex:"state",render:(value:PollView["state"])=><Tag>{pollStates[value]}</Tag>},
      {key:"closes_at",title:"Окончание, Алматы",dataIndex:"closes_at",render:pollDate},
    ]}/>}
    <Space wrap><Button disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Назад</Button><Typography.Text>Страница {Math.floor(offset/20)+1}</Typography.Text><Button disabled={loading||!more} onClick={()=>setOffset(offset+20)}>Дальше</Button></Space>
    <CardDrawer open={drawer} title="Информационный опрос" onClose={close}>
      {cardLoading&&<Spin aria-label="Загрузка карточки опроса"/>}
      {cardError&&<Alert role="alert" type="error" showIcon message={cardError} action={selectedId?<Button onClick={()=>void open(selectedId)}>Повторить загрузку карточки</Button>:undefined}/>}
      {card&&<>
        <PollDetails poll={card}/>
        {card.state==="open"&&card.deadline_passed&&<Alert type="info" showIcon message="Срок ответов истёк. Итоги формируются автоматически."/>}
        {card.state==="draft"&&card.deadline_passed&&<Alert type="warning" showIcon message="Срок прошёл. Измените черновик перед открытием."/>}
        <Space wrap>
          {card.can_manage&&card.state==="draft"&&<><Button onClick={()=>beginAction("edit")}>Изменить черновик</Button><Button type="primary" disabled={card.deadline_passed} onClick={()=>beginAction("open")}>Открыть опрос</Button></>}
          {card.can_manage&&card.state==="open"&&!card.deadline_passed&&<Button danger onClick={()=>beginAction("cancel")}>Отменить опрос</Button>}
        </Space>
        {card.state==="canceled"?<Alert type="info" showIcon message="Результаты отменённого опроса недоступны"/>:card.can_results&&<PollResults key={`${card.id}:${card.version}`} poll={card}/>}
      </>}
      {(action==="create"||action==="edit")&&<PollDraftEditor key={`${identityKey}:${action}:${card?.id??"new"}`} poll={action==="edit"?card:null} onCancel={()=>action==="create"?close():setAction(null)} onSaved={saved}/>}
      {card&&(action==="open"||action==="cancel")&&<PollTransitionEditor key={`${identityKey}:${card.id}:${action}`} poll={card} action={action} onCancel={()=>setAction(null)} onSaved={saved}/>}
    </CardDrawer>
  </PageLayout>;
}
