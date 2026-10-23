import { useEffect,useRef,useState } from "react";
import { Alert,Button,Space,Typography } from "antd";
import { apiFetch } from "../lib/api";
import { DetailSection } from "../components/detail-section";
import { reportDate,reportTitles,type ExportCard,type ReportKind } from "./report-types";
const labels={pending:"В очереди",running:"Формируется",ready:"Готов",failed:"Ошибка"};
const errors:Record<string,string>={ACCESS_REVOKED:"Исходные полномочия отозваны",EXPORT_FAILED:"Не удалось сформировать файл",REPORT_TOO_LARGE:"Отчёт слишком большой; сузьте фильтры"};
function ExportItem({initial}:{initial:ExportCard}){
 const [job,setJob]=useState(initial),[error,setError]=useState<string|null>(null),[url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 async function update(download=false){const g=++generation.current;setBusy(true);setError(null);setUrl(null);try{if(download){const r=await apiFetch<{url:string}>(`/v1/reports/exports/${job.id}/url`);if(g===generation.current)setUrl(r.url);}else{const r=await apiFetch<ExportCard>(`/v1/reports/exports/${job.id}`);if(g===generation.current)setJob(r);}}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Экспорт недоступен");}finally{if(g===generation.current)setBusy(false);}}
 return <div role="group" aria-label={`Экспорт ${job.id}`}><Typography.Paragraph>{reportTitles[job.kind]} · {String(job.filters.from)} — {String(job.filters.to)} · срез {reportDate(job.as_of)} · <span role="status">{labels[job.state]}</span>{job.row_count!==undefined&&job.row_count!==null?` · строк: ${job.row_count}`:""}</Typography.Paragraph>
 {job.error&&<Alert type="error" message={errors[job.error]??"Экспорт недоступен"}/>}{error&&<Alert role="alert" type="error" message={error}/>}
 <Space wrap><Button disabled={busy} onClick={()=>void update()}>Проверить экспорт</Button>{job.state==="ready"&&!error&&<Button disabled={busy} onClick={()=>void update(true)}>Получить ссылку</Button>}{url&&<a href={url} target="_blank" rel="noopener noreferrer">Скачать файл</a>}</Space></div>;
}
export function ReportExports({kind,filters,disabled}:{kind:ReportKind;filters:Record<string,string|undefined>;disabled:boolean}){
 const [jobs,setJobs]=useState<ExportCard[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),intent=useRef({fingerprint:"",key:crypto.randomUUID()}),generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 async function create(){const body:Record<string,unknown>={kind,...filters,building_ids:filters.building_ids?.split(",")};delete body.offset;delete body.limit;const fingerprint=JSON.stringify(body);if(fingerprint!==intent.current.fingerprint)intent.current={fingerprint,key:crypto.randomUUID()};const g=++generation.current;setBusy(true);setError(null);
 try{const job=await apiFetch<ExportCard>("/v1/reports/export",{method:"POST",body,idempotencyKey:intent.current.key});if(g===generation.current){setJobs(old=>[job,...old.filter(j=>j.id!==job.id)].slice(0,10));intent.current={fingerprint:"",key:crypto.randomUUID()};}}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Экспорт не создан");}finally{if(g===generation.current)setBusy(false);}}
 return <DetailSection title="Excel-экспорт"><Button disabled={disabled||busy||kind==="payments"} onClick={()=>void create()}>Создать Excel</Button>{error&&<Alert role="alert" type="error" message={error}/>}<Typography.Paragraph type="secondary">До 10 последних экспортов этого сеанса. Для скачивания права проверяются заново; ссылка действует 5 минут.</Typography.Paragraph>{jobs.map(j=><ExportItem key={j.id} initial={j}/>)}</DetailSection>;
}
