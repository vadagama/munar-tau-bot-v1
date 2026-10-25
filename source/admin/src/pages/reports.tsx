import { FilterOutlined } from "@ant-design/icons";
import { useEffect,useRef,useState } from "react";
import { Alert,Button,Empty,Input,Select,Space,Tabs,Typography } from "antd";
import { PageLayout } from "../components/page-layout";
import { ConfigurableTable } from "../components/configurable-table";
import { DetailSection } from "../components/detail-section";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { usePageRefresh } from "../lib/use-page-refresh";
import { ReportSummary } from "./report-summary";
import { ReportExports } from "./report-exports";
import { reportTitles,reportStates,reportNumber,type ReportKind,type ReportView,type ReportRow } from "./report-types";
function monthPeriod(){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(p=>[p.type,p.value]));const next=new Date(Date.UTC(Number(p.year),Number(p.month),1)).toISOString().slice(0,10);return {from:`${p.year}-${p.month}-01`,to:next};}
export function ReportsPage(){const {identity,roles}=useCabinetIdentity(),key=`${identity?.me?.profile.id??identity?.id??""}:${identity?.me?.emulation?.session_id??""}:${JSON.stringify(identity?.me?.assignments??[])}:${[...roles].sort().join(",")}`;
 const manager=roles.some(r=>["chairman","administrator","deputy"].includes(r)),kinds:ReportKind[]=[...(manager?["requests" as const]:[]),...(roles.length?["tasks" as const]:[]),...(manager||roles.includes("duty")?["incidents" as const]:[]),...(manager||roles.includes("finance")?["payments" as const]:[])];
 return <ReportPanel key={key} kinds={kinds} exportAllowed={roles.some(r=>["chairman","administrator"].includes(r))} configure={roles.includes("chairman")&&!identity?.me?.emulation}/>;
}
function ReportPanel({kinds,exportAllowed,configure}:{kinds:ReportKind[];exportAllowed:boolean;configure:boolean}){
 const [kind,setKind]=useState<ReportKind>(kinds[0]??"tasks"),[dates,setDates]=useState(monthPeriod),[buildings,setBuildings]=useState<string[]>([]),[assignee,setAssignee]=useState<string|undefined>(),[state,setState]=useState<string|undefined>(),[offset,setOffset]=useState(0);
 const [data,setData]=useState<ReportView|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),generation=useRef(0),[expanded,setExpanded]=useState<ReportRow|null>(null);
 const query={...dates,building_ids:buildings.length?buildings.join(","):undefined,assignee_id:assignee,state,offset:String(offset),limit:"50"};
 const fingerprint=JSON.stringify({kind,...query});
 async function load(){if(!kinds.length)return;const g=++generation.current;setBusy(true);setError(null);setExpanded(null);try{const result=await apiFetch<ReportView>(`/v1/reports/${kind}`,{query});if(g===generation.current)setData(result);}catch(e){if(g===generation.current){setData(null);setError(e instanceof Error?e.message:"Отчёт недоступен");}}finally{if(g===generation.current)setBusy(false);}}
 useEffect(()=>{setData(null);void load();return()=>{generation.current++;};},[fingerprint]);
 usePageRefresh(load);
 function switchKind(next:string){setData(null);setKind(next as ReportKind);setState(undefined);setAssignee(undefined);setBuildings([]);setOffset(0);}
 const labels=data?.filter_options?.buildings??[];
 const states=kind==="requests"?["new","reviewing","need_clarification","in_work","on_hold","awaiting_confirmation","rework","closed","canceled","rejected"]:kind==="tasks"?["created","awaiting_acceptance","accepted","in_progress","suspended","on_review","rework","accepted_admin","canceled"]:["signal_check","confirmed","not_confirmed","mitigation","recovery_check","completed"];
 const href=(row:ReportRow)=>kind==="requests"?`/requests?request=${encodeURIComponent(String(row.id))}`:kind==="tasks"?`/tasks?task=${encodeURIComponent(String(row.id))}`:`/incidents?incident=${encodeURIComponent(String(row.id))}`;
 return <PageLayout title="Отчётность" filters={!!kinds.length&&<Space wrap>
 <label>От (включительно)<Input aria-label="Начало периода" type="date" value={dates.from} onChange={e=>{setOffset(0);setDates({...dates,from:e.target.value});}}/></label>
 <label>До (исключительно)<Input aria-label="Конец периода" type="date" value={dates.to} onChange={e=>{setOffset(0);setDates({...dates,to:e.target.value});}}/></label>
 <Select prefix={<FilterOutlined aria-hidden />} aria-label="Дома отчёта" mode="multiple" allowClear placeholder="Все доступные дома" style={{minWidth:200}} value={buildings} options={labels.map(b=>({value:b.id,label:b.label}))} onChange={v=>{setOffset(0);setBuildings(v);}}/>
 <Select prefix={<FilterOutlined aria-hidden />} aria-label="Исполнитель отчёта" allowClear placeholder="Все доступные исполнители" style={{minWidth:210}} value={assignee} options={data?.filter_options?.assignees.map(a=>({value:a.id,label:a.name}))??[]} onChange={v=>{setOffset(0);setAssignee(v);}}/>
 {kind!=="payments"&&<Select prefix={<FilterOutlined aria-hidden />} aria-label="Состояние отчёта" allowClear placeholder="Все состояния" style={{minWidth:190}} value={state} options={states.map(value=>({value,label:reportStates[value]}))} onChange={v=>{setOffset(0);setState(v);}}/>}</Space>}>
 {!kinds.length?<Alert type="info" message="Отчёты доступны сотрудникам ОСИ"/>:<>
 <Tabs activeKey={kind} onChange={switchKind} items={kinds.map(key=>({key,label:reportTitles[key]}))}/>
 {error&&<Alert role="alert" type="error" message={error}/>}
 {data&&!busy&&(data.available?<>
 <ReportSummary report={data}/>
 <Typography.Paragraph>Объектов в выборке: {data.total}</Typography.Paragraph>
 {!data.items.length?<Empty description="Объектов за выбранный период нет"/>:<ConfigurableTable storageKey={`reports-${kind}`} onMobileRowClick={row => { window.location.href = href(row); }} rowKey="id" dataSource={data.items} pagination={false} scroll={{x:760}} columns={[
 {key:"number",title:"Номер",render:(_v:unknown,r:ReportRow)=><a href={href(r)}>{String(r.number)}</a>},
 {key:"title",title:kind==="requests"?"Категория":"Название",render:(_v:unknown,r:ReportRow)=>String(r.title??r.category??"Нет данных")},
 {key:"state",title:"Состояние",render:(_v:unknown,r:ReportRow)=>reportStates[String(r.state)]??"Нет данных"},
 {key:"time",title:"Календарные минуты",render:(_v:unknown,r:ReportRow)=>reportNumber(r.calendar_minutes)},
 {key:"detail",title:"Расчёт",render:(_v:unknown,r:ReportRow)=><Button onClick={()=>setExpanded(r)}>Длительности {String(r.number)}</Button>},
 ]}/>}
 <Space><Button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Назад</Button><Typography.Text>Страница {offset/50+1}</Typography.Text><Button disabled={!data.has_more} onClick={()=>setOffset(offset+50)}>Дальше</Button></Space>
 {expanded&&<DetailSection title={`Длительности ${String(expanded.number)}`}><Typography.Paragraph>Календарные минуты: {reportNumber(expanded.calendar_minutes)}. Первый ответ: календарные {reportNumber(expanded.first_response_calendar_minutes)}, рабочие {reportNumber(expanded.first_response_working_minutes)}.</Typography.Paragraph>
 {Array.isArray(expanded.cycles)&&expanded.cycles.map((c,i)=><Typography.Paragraph key={i}>Цикл {c.number??i+1}: календарные {reportNumber(c.calendar_minutes)} мин, ожидание автора {reportNumber(c.waiting_minutes)} мин · {c.ended?"завершён":"продолжается"}</Typography.Paragraph>)}{Array.isArray(expanded.working_by_timer)&&expanded.working_by_timer.map((t,i)=><Typography.Paragraph key={i}>Рабочие минуты: {reportNumber(t.minutes)}{t.baseline?" · неполная история":""}</Typography.Paragraph>)}<Button onClick={()=>setExpanded(null)}>Скрыть длительности</Button></DetailSection>}
 </>:<Alert type="info" message="Финансовый источник VS-6 пока недоступен; показатели не рассчитываются"/>)}
 {exportAllowed&&<ReportExports kind={kind} filters={query} disabled={busy||!data?.available}/>}
 {configure&&kind==="requests"&&<ReportLaunch onSaved={load}/>}
 </>}
 </PageLayout>;
}
function ReportLaunch({onSaved}:{onSaved:()=>Promise<void>}){const saved=useRef(onSaved);saved.current=onSaved;const [date,setDate]=useState(""),[reason,setReason]=useState(""),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),generation=useRef(0),intent=useRef({fingerprint:"",key:crypto.randomUUID()});useEffect(()=>()=>{generation.current++;},[]);
 async function save(){const body={launched_on:date,reason},f=JSON.stringify(body);if(f!==intent.current.fingerprint)intent.current={fingerprint:f,key:crypto.randomUUID()};const g=++generation.current;setBusy(true);setError(null);try{await apiFetch("/v1/reports/launch",{method:"POST",body,idempotencyKey:intent.current.key});if(g===generation.current){setReason("");intent.current.fingerprint="";await saved.current();}}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Дата не сохранена");}finally{if(g===generation.current)setBusy(false);}}
 return <DetailSection title="Дата запуска KPI"><Space wrap><Input type="date" aria-label="Дата запуска KPI" value={date} onChange={e=>setDate(e.target.value)}/><Input aria-label="Причина настройки KPI" placeholder="Причина" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/><Button disabled={busy||!date||!reason.trim()} onClick={()=>void save()}>Сохранить дату запуска</Button></Space>{error&&<Alert role="alert" type="error" message={error}/>}</DetailSection>;}
